const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 90;
const OUTCOME_DAYS = 30;
const SNAPSHOT_DAYS = 30;
const MODEL_VERSION = 'attendance-logistic-v1';
const BASELINE_VERSION = 'attendance-baseline-v2';

const MINIMUMS = {
  trainingExamples: 100,
  trainingParticipants: 20,
  trainingPositive: 20,
  trainingNegative: 20,
  testExamples: 30,
  testParticipants: 20,
  testPositive: 10,
  testNegative: 10,
};

function sigmoid(value) {
  if (value >= 0) {
    const exponent = Math.exp(-value);
    return 1 / (1 + exponent);
  }
  const exponent = Math.exp(value);
  return exponent / (1 + exponent);
}

function classify(rows, coefficients) {
  return rows.map(({ features }) => sigmoid(
    coefficients[0] + coefficients[1] * features[0] + coefficients[2] * features[1],
  ));
}

function fitLogisticRegression(rows) {
  const positiveRate = rows.reduce((sum, row) => sum + row.label, 0) / rows.length;
  const clippedRate = Math.min(1 - 1e-6, Math.max(1e-6, positiveRate));
  const coefficients = [Math.log(clippedRate / (1 - clippedRate)), 0, 0];
  const learningRate = 0.1;
  const regularization = 0.01;
  const iterations = 2500;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradients = [0, 0, 0];
    for (const row of rows) {
      const probability = sigmoid(
        coefficients[0] + coefficients[1] * row.features[0] + coefficients[2] * row.features[1],
      );
      const error = probability - row.label;
      gradients[0] += error;
      gradients[1] += error * row.features[0];
      gradients[2] += error * row.features[1];
    }
    gradients[0] /= rows.length;
    gradients[1] = gradients[1] / rows.length + regularization * coefficients[1];
    gradients[2] = gradients[2] / rows.length + regularization * coefficients[2];
    for (let index = 0; index < coefficients.length; index += 1) {
      coefficients[index] -= learningRate * gradients[index];
    }
  }
  return coefficients;
}

function getMetrics(labels, probabilities) {
  const positives = labels.reduce((sum, label) => sum + label, 0);
  const prevalence = positives / labels.length;
  const brierScore = probabilities.reduce(
    (sum, probability, index) => sum + (probability - labels[index]) ** 2,
    0,
  ) / labels.length;
  const calibrationBins = Array.from({ length: 5 }, () => ({
    count: 0,
    probabilitySum: 0,
    positiveSum: 0,
  }));
  for (let index = 0; index < labels.length; index += 1) {
    const bin = calibrationBins[Math.min(4, Math.floor(probabilities[index] * 5))];
    bin.count += 1;
    bin.probabilitySum += probabilities[index];
    bin.positiveSum += labels[index];
  }
  const expectedCalibrationError = calibrationBins.reduce((sum, bin) => {
    if (!bin.count) return sum;
    const probabilityMean = bin.probabilitySum / bin.count;
    const observedRate = bin.positiveSum / bin.count;
    return sum + (bin.count / labels.length) * Math.abs(probabilityMean - observedRate);
  }, 0);
  const ranked = labels
    .map((label, index) => ({ label, probability: probabilities[index] }))
    .sort((left, right) => right.probability - left.probability);
  let seenPositives = 0;
  let seenExamples = 0;
  let previousRecall = 0;
  let prAuc = 0;
  for (let index = 0; index < ranked.length;) {
    const threshold = ranked[index].probability;
    let groupPositives = 0;
    let groupSize = 0;
    while (index < ranked.length && ranked[index].probability === threshold) {
      groupPositives += ranked[index].label;
      groupSize += 1;
      index += 1;
    }
    seenPositives += groupPositives;
    seenExamples += groupSize;
    const recall = seenPositives / positives;
    const precision = seenPositives / seenExamples;
    prAuc += (recall - previousRecall) * precision;
    previousRecall = recall;
  }
  const truePositive = labels.reduce(
    (sum, label, index) => sum + (label && probabilities[index] >= 0.5 ? 1 : 0),
    0,
  );
  const predictedPositive = probabilities.filter((probability) => probability >= 0.5).length;

  return {
    examples: labels.length,
    positive: positives,
    negative: labels.length - positives,
    prevalence: roundMetric(prevalence),
    prAuc: roundMetric(prAuc),
    brierScore: roundMetric(brierScore),
    expectedCalibrationError: roundMetric(expectedCalibrationError),
    precisionAtHalf: roundMetric(predictedPositive ? truePositive / predictedPositive : 0),
    recallAtHalf: roundMetric(positives ? truePositive / positives : 0),
  };
}

function roundMetric(value) {
  return Number(value.toFixed(4));
}

function upperBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function getAttendanceFeatures(dates, snapshot) {
  const priorEnd = upperBound(dates, snapshot);
  if (!priorEnd) return null;
  const historyStart = snapshot - HISTORY_DAYS * DAY_MS;
  const historyStartIndex = upperBound(dates, historyStart);
  const weeks = new Set();
  for (let index = historyStartIndex; index < priorEnd; index += 1) {
    weeks.add(Math.floor(dates[index] / (7 * DAY_MS)));
  }
  const latestPriorCheckin = dates[priorEnd - 1];
  return [
    Math.min(weeks.size / 13, 1),
    Math.min((snapshot - latestPriorCheckin) / (45 * DAY_MS), 1),
  ];
}

function buildExamples(checkins, referenceTime = Date.now()) {
  const byParticipant = new Map();
  let earliest = Number.POSITIVE_INFINITY;
  for (const record of checkins) {
    if (record.participantId === null || record.participantId === undefined) continue;
    const participantId = String(record.participantId);
    const checkedInAt = Number(record.checkedInAt);
    if (!participantId || !Number.isFinite(checkedInAt)) continue;
    if (!byParticipant.has(participantId)) byParticipant.set(participantId, []);
    byParticipant.get(participantId).push(checkedInAt);
    earliest = Math.min(earliest, checkedInAt);
  }
  if (!Number.isFinite(earliest)) return [];
  for (const dates of byParticipant.values()) dates.sort((left, right) => left - right);

  const firstSnapshot = Math.floor(earliest / DAY_MS) * DAY_MS + HISTORY_DAYS * DAY_MS;
  const latestSnapshot = referenceTime - OUTCOME_DAYS * DAY_MS;
  const examples = [];
  for (let snapshot = firstSnapshot; snapshot <= latestSnapshot; snapshot += SNAPSHOT_DAYS * DAY_MS) {
    const outcomeEnd = snapshot + OUTCOME_DAYS * DAY_MS;
    for (const [participantId, dates] of byParticipant) {
      const features = getAttendanceFeatures(dates, snapshot);
      if (features) {
        const firstFutureCheckin = upperBound(dates, snapshot);
        const outcomeEndIndex = upperBound(dates, outcomeEnd);
        examples.push({
          participantId,
          snapshot,
          features,
          label: firstFutureCheckin === outcomeEndIndex ? 1 : 0,
        });
      }
    }
  }
  return examples;
}

function getTemporalSplit(examples) {
  const snapshotDates = [...new Set(examples.map((row) => row.snapshot))].sort((a, b) => a - b);
  if (snapshotDates.length < 3) return { training: [], test: [], splitDate: null };
  const splitIndex = Math.max(1, Math.floor(snapshotDates.length * 0.8));
  if (splitIndex >= snapshotDates.length) return { training: [], test: [], splitDate: null };
  const splitDate = snapshotDates[splitIndex];
  return {
    training: examples.filter((row) => row.snapshot + OUTCOME_DAYS * DAY_MS <= splitDate),
    test: examples.filter((row) => row.snapshot >= splitDate),
    splitDate,
  };
}

function validateAttendanceModel(checkins, referenceTime = Date.now()) {
  const examples = buildExamples(checkins, referenceTime);
  const split = getTemporalSplit(examples);
  const trainingLabels = split.training.map((row) => row.label);
  const testLabels = split.test.map((row) => row.label);
  const testParticipants = new Set(split.test.map((row) => row.participantId)).size;
  const counts = {
    trainingExamples: split.training.length,
    trainingParticipants: new Set(split.training.map((row) => row.participantId)).size,
    trainingPositive: trainingLabels.reduce((sum, label) => sum + label, 0),
    trainingNegative: trainingLabels.filter((label) => label === 0).length,
    testExamples: split.test.length,
    testParticipants,
    testPositive: testLabels.reduce((sum, label) => sum + label, 0),
    testNegative: testLabels.filter((label) => label === 0).length,
  };
  const reasons = Object.entries(MINIMUMS)
    .filter(([key, minimum]) => counts[key] < minimum)
    .map(([key, minimum]) => `${key} must be at least ${minimum}; observed ${counts[key]}`);

  let metrics = null;
  let baseline = null;
  let validationPassed = false;
  if (!reasons.length) {
    const coefficients = fitLogisticRegression(split.training);
    const testProbabilities = classify(split.test, coefficients);
    metrics = getMetrics(testLabels, testProbabilities);
    const baselineProbability = counts.trainingPositive / counts.trainingExamples;
    baseline = getMetrics(testLabels, testLabels.map(() => baselineProbability));
    validationPassed = metrics.prAuc > baseline.prevalence &&
      metrics.brierScore < baseline.brierScore &&
      metrics.expectedCalibrationError <= baseline.expectedCalibrationError;
    if (!validationPassed) {
      reasons.push('Holdout PR-AUC and Brier score must outperform the prevalence baseline, and calibration error must be no worse');
    }
  }

  let finalCoefficients = null;
  if (validationPassed) finalCoefficients = fitLogisticRegression(examples);
  return {
    status: validationPassed ? 'validated' : 'insufficient_or_failed',
    modelVersion: validationPassed ? MODEL_VERSION : BASELINE_VERSION,
    target: 'No attendance check-in during the 30 days after each score date',
    evaluationMethod: '30-day-spaced snapshots with a chronological holdout and a 30-day label embargo',
    evaluatedAt: new Date(referenceTime).toISOString(),
    counts,
    metrics,
    baseline,
    reasons,
    coefficients: finalCoefficients,
  };
}

function predictInactivityProbability(features, coefficients) {
  if (!Array.isArray(features) || features.length !== 2 || !coefficients || coefficients.length !== 3) {
    throw new Error('A validated model and two attendance features are required');
  }
  return sigmoid(coefficients[0] + coefficients[1] * features[0] + coefficients[2] * features[1]);
}

function getCurrentAttendanceFeatures(checkins, participantIds, referenceTime = Date.now()) {
  const byParticipant = new Map();
  for (const record of checkins) {
    const participantId = String(record.participantId);
    const checkedInAt = Number(record.checkedInAt);
    if (!Number.isFinite(checkedInAt)) continue;
    if (!byParticipant.has(participantId)) byParticipant.set(participantId, []);
    byParticipant.get(participantId).push(checkedInAt);
  }
  for (const dates of byParticipant.values()) dates.sort((left, right) => left - right);
  return new Map([...participantIds].map((participantId) => {
    const id = String(participantId);
    return [id, getAttendanceFeatures(byParticipant.get(id) || [], referenceTime) || [0, 1]];
  }));
}

function scoreAttendanceBaseline(attendanceWeeks, recencyDays) {
  const coverage = Math.min(Math.max(attendanceWeeks, 0) / 13, 1);
  const inactivity = Math.min(Math.max(recencyDays, 0) / 45, 1);
  return roundMetric(50 * (1 - coverage) + 50 * inactivity);
}

module.exports = {
  BASELINE_VERSION,
  MODEL_VERSION,
  buildExamples,
  getCurrentAttendanceFeatures,
  predictInactivityProbability,
  scoreAttendanceBaseline,
  validateAttendanceModel,
};
