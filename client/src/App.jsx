import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Html5Qrcode } from "html5-qrcode";
import { Chart, registerables } from "chart.js";
import { queueCheckin, syncQueuedCheckins } from "./offlineCheckinQueue";
import "./App.css";
Chart.register(...registerables);

// Robust API call helper that includes Authorization when available
const apiCall = async (p, o = {}) => {
  const existingHeaders = (o && o.headers) || {};
  const headers = {
    "Content-Type": "application/json",
    ...existingHeaders,
    ...(localStorage.token ? { Authorization: `Bearer ${localStorage.token}` } : {}),
  };
  const r = await fetch(api + p, { ...o, headers });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.dispatchEvent(new Event("auth-expired"));
  }
  if (!r.ok) throw Error(d.error || "Request failed");
  return d;
};
const api = "/api";
const STAFF_ROLES = ["system administrator", "church administrator"];
const STAFF_PERMISSION_OPTIONS = [
  { key: "dashboard:view", label: "Dashboard", description: "View system overview and summary metrics." },
  { key: "participants:view", label: "View participants", description: "Browse participant records and profiles." },
  { key: "participants:manage", label: "Manage participants", description: "Register, view, edit, and remove participant records." },
  { key: "events:view", label: "View events", description: "View events and event attendance lists." },
  { key: "events:manage", label: "Manage events", description: "View, create, and update events." },
  { key: "checkin:record", label: "Check-in", description: "Record attendance at the check-in station." },
  { key: "analytics:view", label: "Analytics", description: "View and refresh participant analytics." },
  { key: "reports:view", label: "Reports", description: "View and export attendance reports and sponsored-child monitoring data when authorized." },
  { key: "portal:view", label: "Participant QR portal", description: "Look up participant details using a QR code and passcode." },
  { key: "sponsorship:view", label: "View sponsored care", description: "View child lifecycle, allowance history, and letter threads." },
  { key: "sponsorship:manage", label: "Manage sponsored care", description: "Record growth, activity, and care updates; update lifecycle and allowances; attach receipt proof; and reply to letters." },
];
const DEFAULT_STAFF_PERMISSION_KEYS = STAFF_PERMISSION_OPTIONS
  .map(({ key }) => key)
  .filter((key) => !key.startsWith("sponsorship:"));
const PAGE_PERMISSIONS = {
  dashboard: "dashboard:view",
  participants: "participants:view",
  events: "events:view",
  scanner: "checkin:record",
  analytics: "analytics:view",
  reports: "reports:view",
  portal: "portal:view",
  sponsorship: "sponsorship:view",
};
const PAGE_ACCESS = {
  account: STAFF_ROLES,
  audit: ["system administrator"],
  staff: ["system administrator"],
};
const PAGE_LINKS = [
  ["dashboard", "Overview"],
  ["participants", "Participants"],
  ["events", "Events"],
  ["scanner", "Check-in"],
  ["analytics", "Analytics"],
  ["reports", "Reports"],
  ["portal", "Child portal"],
  ["sponsorship", "Sponsored care"],
  ["staff", "Staff accounts"],
  ["audit", "Audit history"],
];
const canAccessPermission = (permission, user) => {
  const role = String(user?.role || user || "").toLowerCase();
  if (role === "system administrator") return true;
  if (!permission || !STAFF_ROLES.includes(role)) return false;
  const permissions = Array.isArray(user?.permissions)
    ? user.permissions
    : DEFAULT_STAFF_PERMISSION_KEYS;
  if (permissions.includes(permission)) return true;
  return (
    (permission === "participants:view" && permissions.includes("participants:manage")) ||
    (permission === "events:view" && permissions.includes("events:manage")) ||
    (permission === "sponsorship:view" && permissions.includes("sponsorship:manage"))
  );
};
const canAccessPage = (page, user) => {
  const role = String(user?.role || user || "").toLowerCase();
  if (PAGE_ACCESS[page]) return PAGE_ACCESS[page].includes(role);
  return canAccessPermission(PAGE_PERMISSIONS[page], user);
};
const EDUCATION_LEVELS = [
  "Elementary",
  "Junior High School",
  "Senior High School",
  "College",
];
const GENDER_OPTIONS = ["Male", "Female", "Prefer not to say"];
const GRADE_LEVELS = {
  Elementary: Array.from({ length: 6 }, (_, index) => `Grade ${index + 1}`),
  "Junior High School": Array.from({ length: 4 }, (_, index) => `Grade ${index + 7}`),
  "Senior High School": ["Grade 11", "Grade 12"],
  College: Array.from({ length: 6 }, (_, index) => `Year ${index + 1}`),
};
function sponsoredChildEligibilityError(participant) {
  if (participant.participantType !== "sponsored_child") return "";
  const dateOfBirth = String(participant.dateOfBirth || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    return "Date of birth is required for sponsored children.";
  }
  const birthDate = new Date(`${dateOfBirth}T00:00:00.000Z`);
  if (
    Number.isNaN(birthDate.getTime()) ||
    birthDate.toISOString().slice(0, 10) !== dateOfBirth ||
    birthDate > new Date()
  ) {
    return "Enter a valid date of birth.";
  }
  const today = new Date();
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
  if (
    today.getUTCMonth() < birthDate.getUTCMonth() ||
    (today.getUTCMonth() === birthDate.getUTCMonth() && today.getUTCDate() < birthDate.getUTCDate())
  ) {
    age -= 1;
  }
  if (age < 6 || age > 22) {
    return "Sponsored children must be between 6 and 22 years old.";
  }
  if (!EDUCATION_LEVELS.includes(participant.educationLevel)) {
    return "Select an education level for the sponsored child.";
  }
  if (!GRADE_LEVELS[participant.educationLevel]?.includes(participant.gradeLevel)) {
    return "Select a valid grade or year level for the education level.";
  }
  if (participant.educationLevel === "College" && !participant.programCourse?.trim()) {
    return "Enter the college program or course.";
  }
  return "";
}
function composeFullName(person) {
  return [person.firstName, person.middleName, person.lastName]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
}
function participantNameFields(person) {
  if (person.firstName || person.middleName || person.lastName) {
    return {
      firstName: person.firstName || "",
      middleName: person.middleName || "",
      lastName: person.lastName || "",
    };
  }
  const parts = String(person.fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return { firstName: parts[0] || "", middleName: "", lastName: "" };
  }
  return {
    firstName: parts[0],
    middleName: parts.length > 2 ? parts.slice(1, -1).join(" ") : "",
    lastName: parts[parts.length - 1],
  };
}
const call = async (p, o = {}) => {
  const r = await fetch(api + p, {
    ...o,
    headers: {
      "Content-Type": "application/json",
      ...(localStorage.token
        ? { Authorization: `Bearer ${localStorage.token}` }
        : {}),
    },
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.dispatchEvent(new Event("auth-expired"));
  }
  if (!r.ok) throw Error(d.error || "Request failed");
  return d;
};
const Title = ({ e, t, d }) => (
  <div className="page-title">
    <div>
      <span className="eyebrow">{e}</span>
      <h1>{t}</h1>
    </div>
    <p>{d}</p>
  </div>
);
const Badge = ({ level }) => (
  <span className={`risk-badge ${level}`}>{level}</span>
);
function Login({ done, onBack }) {
  const [f, setF] = useState({ username: "", password: "" });
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const eligibilityError = sponsoredChildEligibilityError(f);
    if (eligibilityError) {
      alert(eligibilityError);
      return;
    }
    setSubmitting(true);
    setErr("");
    try {
      const d = await apiCall("/auth/login", {
        method: "POST",
        body: JSON.stringify(f),
      });
      localStorage.token = d.token;
      localStorage.user = JSON.stringify(d.user);
      done(d.user);
    } catch (x) {
      setErr(x.message);
      setSubmitting(false);
    }
  };
  return (
    <>
      <main className="login-page">
        <div className="login-panel">
          {onBack && (
            <button
              type="button"
              className="login-back-button"
              onClick={onBack}
              disabled={submitting}
            >
              <span aria-hidden="true">←</span>
              Back to home
            </button>
          )}
          <div className="brand-mark">
            <img src="/church-logo.png" alt="FMC Field Care logo" />
            <span>FMC FIELD CARE</span>
          </div>
          <h1>Welcome back</h1>
          <p className="text-secondary mb-4">Secure participant monitoring</p>
          <form onSubmit={submit} className="vstack gap-3">
            <input
              className="form-control form-control-lg"
              placeholder="Username or email"
              value={f.username}
              onChange={(e) => setF({ ...f, username: e.target.value })}
              autoComplete="username"
              disabled={submitting}
              required
            />
            <input
              className="form-control form-control-lg"
              type="password"
              placeholder="Password"
              value={f.password}
              onChange={(e) => setF({ ...f, password: e.target.value })}
              autoComplete="current-password"
              disabled={submitting}
              required
            />
            <button className="btn btn-dark btn-lg" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in →"}
            </button>
            {err && <div className="alert alert-danger" role="alert">{err}</div>}
          </form>
        </div>
        <div className="login-art">
          <div>
            <span className="eyebrow">MONITORING SYSTEM / 2026</span>
            <h2>
              Care becomes
              <br />
              <em>visible.</em>
            </h2>
            <p>One clear view of every arrival, milestone, and next step.</p>
          </div>
        </div>
      </main>
      {submitting && <LoadingScreen message="Signing you in…" />}
    </>
  );
}
function LoadingScreen({ message }) {
  return (
    <div className="loading-screen" role="status" aria-live="polite" aria-label={message}>
      <span className="loading-screen-spinner" aria-hidden="true" />
      <strong>{message}</strong>
      <span className="visually-hidden">Please wait.</span>
    </div>
  );
}
function Header({ user, page, go, logout }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isStaff = STAFF_ROLES.includes(String(user.role).toLowerCase());
  const links = PAGE_LINKS.filter(([key]) => canAccessPage(key, user));
  return (
    <aside className="topbar app-sidebar">
      <button className="brand-button" onClick={() => go("dashboard")}>
        <img src="/church-logo.png" alt="" />
        <span>FMC FIELD CARE</span>
      </button>
      <button
        className="mobile-menu-toggle"
        type="button"
        aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={menuOpen}
        aria-controls="primary-navigation"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span />
        <span />
        <span />
      </button>
      <nav
        id="primary-navigation"
        aria-label="Main navigation"
        className={`nav-pills${menuOpen ? " is-open" : ""}`}
      >
        {links.map(([k, l]) => (
          <button
            key={k}
            className={page === k ? "active" : ""}
            onClick={() => {
              go(k);
              setMenuOpen(false);
            }}
          >
            {l}
          </button>
        ))}
      </nav>
      <div className="user-menu">
        <span className="avatar">{user.username?.[0]?.toUpperCase()}</span>
        {isStaff ? (
          <button
            className="account-trigger d-none d-md-inline"
            type="button"
            aria-label="Open account settings"
            onClick={() => go("account")}
          >
            {user.username}
          </button>
        ) : (
          <span className="d-none d-md-inline">{user.role}</span>
        )}
        <button className="btn btn-sm btn-outline-secondary" onClick={logout}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
function AccountSettings({ onUserUpdated }) {
  const [account, setAccount] = useState(null);
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accountMessage, setAccountMessage] = useState("");
  const [accountError, setAccountError] = useState("");
  const [email, setEmail] = useState("");
  const [emailCurrentPassword, setEmailCurrentPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const [emailError, setEmailError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiCall("/account")
      .then(({ user: profile }) => {
        setAccount(profile);
        setUsername(profile.username);
        setEmail(profile.email);
      })
      .catch((error) => setAccountError(error.message))
      .finally(() => setLoading(false));
  }, []);

  const updateCredentials = async (event) => {
    event.preventDefault();
    setAccountMessage("");
    setAccountError("");
    if (newPassword && newPassword !== confirmPassword) {
      setAccountError("New password and confirmation do not match.");
      return;
    }
    try {
      const result = await apiCall("/account", {
        method: "PUT",
        body: JSON.stringify({ username, currentPassword, newPassword }),
      });
      localStorage.token = result.token;
      localStorage.user = JSON.stringify(result.user);
      onUserUpdated(result.user);
      setAccount(result.user);
      setUsername(result.user.username);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setAccountMessage("Account credentials updated.");
    } catch (error) {
      setAccountError(error.message);
    }
  };

  const requestEmailCode = async (event) => {
    event.preventDefault();
    setEmailMessage("");
    setEmailError("");
    try {
      const result = await apiCall("/account/email/request", {
        method: "POST",
        body: JSON.stringify({ email, currentPassword: emailCurrentPassword }),
      });
      setCodeSent(true);
      setVerificationCode("");
      setEmailMessage(result.message);
    } catch (error) {
      setEmailError(error.message);
    }
  };

  const verifyEmailCode = async (event) => {
    event.preventDefault();
    setEmailMessage("");
    setEmailError("");
    try {
      const result = await apiCall("/account/email/verify", {
        method: "POST",
        body: JSON.stringify({ email, code: verificationCode }),
      });
      localStorage.user = JSON.stringify(result.user);
      onUserUpdated(result.user);
      setAccount(result.user);
      setEmail(result.user.email);
      setEmailCurrentPassword("");
      setVerificationCode("");
      setCodeSent(false);
      setEmailMessage("Email address updated successfully.");
    } catch (error) {
      setEmailError(error.message);
    }
  };

  return (
    <>
      <Title
        e="ADMIN ACCOUNT"
        t="Manage your account."
        d="Update your username, password, and verified email address."
      />
      {loading ? (
        <p role="status">Loading account details...</p>
      ) : (
        <div className="row g-4">
          <section className="col-12 col-lg-6">
            <div className="surface form-surface account-panel">
              <h2>Username and password</h2>
              <form className="vstack gap-3" onSubmit={updateCredentials}>
                <div>
                  <label className="form-label" htmlFor="account-username">Username</label>
                  <input
                    id="account-username"
                    className="form-control"
                    autoComplete="username"
                    maxLength={100}
                    required
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="account-current-password">Current password</label>
                  <input
                    id="account-current-password"
                    className="form-control"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="account-new-password">New password (optional)</label>
                  <input
                    id="account-new-password"
                    className="form-control"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={72}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                  <small className="text-secondary">Leave blank if you are only changing your username.</small>
                </div>
                {newPassword && (
                  <div>
                    <label className="form-label" htmlFor="account-confirm-password">Confirm new password</label>
                    <input
                      id="account-confirm-password"
                      className="form-control"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                    />
                  </div>
                )}
                {accountError && <div className="alert alert-danger mb-0">{accountError}</div>}
                {accountMessage && <div className="alert alert-success mb-0">{accountMessage}</div>}
                <button className="btn btn-dark align-self-start" type="submit">
                  Save credentials
                </button>
              </form>
            </div>
          </section>
          <section className="col-12 col-lg-6">
            <div className="surface form-surface account-panel">
              <h2>Change email</h2>
              <p className="text-secondary">
                A verification code will be sent to the new address. The email changes only after you enter that code.
              </p>
              <form
                className="vstack gap-3"
                onSubmit={codeSent ? verifyEmailCode : requestEmailCode}
              >
                <div>
                  <label className="form-label" htmlFor="account-email">New email</label>
                  <input
                    id="account-email"
                    className="form-control"
                    type="email"
                    autoComplete="email"
                    maxLength={150}
                    required
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setCodeSent(false);
                      setVerificationCode("");
                    }}
                  />
                  {account?.email && <small className="text-secondary">Current email: {account.email}</small>}
                </div>
                <div>
                  <label className="form-label" htmlFor="account-email-current-password">Current password</label>
                  <input
                    id="account-email-current-password"
                    className="form-control"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={emailCurrentPassword}
                    onChange={(event) => setEmailCurrentPassword(event.target.value)}
                  />
                </div>
                {codeSent && (
                  <div>
                    <label className="form-label" htmlFor="account-email-code">Verification code</label>
                    <input
                      id="account-email-code"
                      className="form-control"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      value={verificationCode}
                      onChange={(event) => setVerificationCode(event.target.value)}
                    />
                  </div>
                )}
                {emailError && <div className="alert alert-danger mb-0">{emailError}</div>}
                {emailMessage && <div className="alert alert-success mb-0">{emailMessage}</div>}
                {!codeSent ? (
                  <button className="btn btn-dark align-self-start" type="submit">
                    Send verification code
                  </button>
                ) : (
                  <button
                    className="btn btn-dark align-self-start"
                    type="submit"
                  >
                    Verify and update email
                  </button>
                )}
              </form>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
const Field = ({ label, ...p }) => (
  <div className="col-12 col-md-6">
    <label className="form-label">{label}</label>
    <input className="form-control" {...p} />
  </div>
);
const GenderSelect = ({ id, value, onChange }) => (
  <div className="col-12 col-md-6">
    <label className="form-label" htmlFor={id}>Gender</label>
    <select
      id={id}
      className="form-select"
      value={value || ""}
      onChange={onChange}
    >
      <option value="">Select gender (optional)</option>
      {value && !GENDER_OPTIONS.includes(value) && (
        <option value={value}>{value} (existing)</option>
      )}
      {GENDER_OPTIONS.map((option) => <option key={option}>{option}</option>)}
    </select>
  </div>
);
const TypeChoice = ({ value, onChange }) => (
  <div className="col-12">
    <label className="form-label">Participant type</label>
    <div className="type-choice" role="group" aria-label="Participant type">
      <button
        type="button"
        className={value === "sponsored_child" ? "selected" : ""}
        onClick={() => onChange("sponsored_child")}
      >
        <strong>Sponsored Child</strong>
        <small>Health, guardian, sponsor, and program details</small>
      </button>
      <button
        type="button"
        className={value === "goer" ? "selected" : ""}
        onClick={() => onChange("goer")}
      >
        <strong>Goer</strong>
        <small>Personal information only</small>
      </button>
    </div>
  </div>
);
function Dashboard({ go }) {
  const [d, setD] = useState({ counts: {}, recentCheckins: [], atRisk: [] });
  const [greeting, setGreeting] = useState(() => getGreeting());
  useEffect(() => {
    apiCall("/dashboard")
      .then(setD)
      .catch(() => {});
  }, []);
  useEffect(() => {
    const interval = window.setInterval(() => setGreeting(getGreeting()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
  return (
    <>
      <Title
        e="COMMAND CENTER"
        t={`Good ${greeting}.`}
        d="A live pulse on participation and care."
      />
      <div className="row g-3 mb-4">
        {[
          [
            "Active participants",
            d.counts.activeParticipants ?? "—",
            `${d.counts.participants ?? "—"} total records`,
          ],
          ["Check-ins this week", d.counts.totalCheckins ?? "—", "Last 7 days"],
          ["Goers checked-in (week)", d.counts.goerCheckins ?? "—", "Last 7 days"],
          ["Attendance review", d.atRisk.length, "Elevated attendance scores"],
        ].map((x) => (
          <div className="col-12 col-sm-6 col-lg-2" key={x[0]}>
            <div className="stat-card">
              <small>{x[0]}</small>
              <strong>{x[1]}</strong>
              <span>{x[2]}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="row g-4">
        <section className="col-12 col-lg-7">
          <h2>Recent check-ins</h2>
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Participant</th>
                  <th>Event</th>
                  <th>Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {d.recentCheckins.map((r, i) => (
                  <tr key={i}>
                    <td>#{r.participant_id}</td>
                    <td>{r.event_name}</td>
                    <td>
                      {r.checked_in_at
                        ? new Date(r.checked_in_at).toLocaleString()
                        : "—"}
                    </td>
                    <td>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="col-12 col-lg-5">
          <h2>Attendance follow-up prompts</h2>
          <p className="text-secondary small">Review attendance context with staff. Scores do not determine a child’s circumstances.</p>
          <div className="risk-list">
            {d.atRisk.map((r) => (
              <div className="risk-row" key={`${r.id}-${r.computed_at}`}>
                <div>
                  <strong>
                    {r.participant_code || `Participant #${r.id}`}
                  </strong>
                  <small>{r.model_version} · {r.computed_at}</small>
                </div>
                <Badge level={r.risk_level} />
                <strong className="risk-score">
                  {Number(r.risk_score).toFixed(0)}
                </strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}
function Register({ onClose, onCreated }) {
  const blank = {
    firstName: "",
    middleName: "",
    lastName: "",
    dateOfBirth: "",
    gender: "",
    phone: "",
    address: "",
    participantType: "goer",
    educationLevel: "",
    gradeLevel: "",
    programCourse: "",
    weight: "",
    height: "",
    medicalConditions: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    sponsorName: "",
    sponsorContact: "",
    sponsorshipType: "",
    enrollmentDate: "",
    programAffiliation: "",
  };
  const [f, setF] = useState(blank);
  const [result, setR] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const created = await apiCall("/participants", {
        method: "POST",
        body: JSON.stringify({ ...f, fullName: composeFullName(f) }),
      });
      setR(created);
      setF(blank);
      await onCreated();
    } catch (x) {
      setError(x.message);
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return createPortal((
    <div className="participant-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="participant-modal" role="dialog" aria-modal="true" aria-labelledby="register-participant-title">
        <header className="participant-modal-header">
          <div>
            <span className="eyebrow">PARTICIPANTS / NEW RECORD</span>
            <h2 id="register-participant-title">{result ? "Participant registered." : "Register a participant."}</h2>
            <p>Create an encrypted profile and issue a secure digital ID.</p>
          </div>
          <button type="button" className="btn-close" aria-label="Close registration" onClick={onClose} />
        </header>
        {result ? (
          <div className="participant-registration-success">
            <span className="eyebrow">DIGITAL ID READY</span>
            <h3>{result.participantCode}</h3>
            <img src={result.qrCodeImage} alt="Generated participant QR code" />
            {result.passcode && (
              <div className="participant-generated-passcode" role="status">
                <span className="eyebrow">GUARDIAN PORTAL PASSCODE</span>
                <strong>{result.passcode}</strong>
                <p>Share this passcode securely with the child’s guardian. It is shown only during registration.</p>
              </div>
            )}
            <div className="d-flex flex-wrap justify-content-center gap-2">
              <button type="button" className="btn btn-outline-dark" onClick={() => window.print()}>Print card</button>
              <button type="button" className="btn btn-dark" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="row g-3">
              <Field label="First name" value={f.firstName} onChange={update("firstName")} required />
              <Field label="Middle name (optional)" value={f.middleName} onChange={update("middleName")} />
              <Field label="Last name" value={f.lastName} onChange={update("lastName")} required />
              <Field
                label="Date of birth"
                type="date"
                value={f.dateOfBirth}
                onChange={update("dateOfBirth")}
                required={f.participantType === "sponsored_child"}
              />
              <TypeChoice
                value={f.participantType}
                onChange={(value) => setF({ ...f, participantType: value })}
              />
              <GenderSelect
                id="register-gender"
                value={f.gender}
                onChange={update("gender")}
              />
              <Field label="Phone" value={f.phone} onChange={update("phone")} />
              <Field
                label="Address"
                value={f.address}
                onChange={update("address")}
              />
              {f.participantType === "sponsored_child" && (
                <>
                  <div className="col-12">
                    <p className="text-secondary mb-0">
                      Sponsored children must be 6–22 years old and select an education level and grade/year. College students must also provide their course.
                    </p>
                  </div>
                  <div className="col-12 col-md-6">
                    <label className="form-label" htmlFor="register-education-level">Education level</label>
                    <select
                      id="register-education-level"
                      className="form-select"
                      value={f.educationLevel}
                      onChange={(event) => setF({
                        ...f,
                        educationLevel: event.target.value,
                        gradeLevel: "",
                        programCourse: event.target.value === "College" ? f.programCourse : "",
                      })}
                      required
                    >
                      <option value="">Select education level</option>
                      {EDUCATION_LEVELS.map((level) => <option key={level}>{level}</option>)}
                    </select>
                  </div>
                  {f.educationLevel && (
                    <div className="col-12 col-md-6">
                      <label className="form-label" htmlFor="register-grade-level">
                        {f.educationLevel === "College" ? "College year" : "Grade level"}
                      </label>
                      <select
                        id="register-grade-level"
                        className="form-select"
                        value={f.gradeLevel}
                        onChange={update("gradeLevel")}
                        required
                      >
                        <option value="">Select {f.educationLevel === "College" ? "college year" : "grade level"}</option>
                        {GRADE_LEVELS[f.educationLevel].map((grade) => <option key={grade}>{grade}</option>)}
                      </select>
                    </div>
                  )}
                  {f.educationLevel === "College" && (
                    <Field
                      label="College program or course"
                      value={f.programCourse}
                      onChange={update("programCourse")}
                      required
                    />
                  )}
                  <Field
                    label="Weight"
                    placeholder="e.g. 32 kg"
                    value={f.weight}
                    onChange={update("weight")}
                  />
                  <Field
                    label="Height"
                    placeholder="e.g. 132 cm"
                    value={f.height}
                    onChange={update("height")}
                  />
                  <Field
                    label="Medical conditions"
                    value={f.medicalConditions}
                    onChange={update("medicalConditions")}
                  />
                  <Field
                    label="Emergency contact name"
                    value={f.emergencyContactName}
                    onChange={update("emergencyContactName")}
                  />
                  <Field
                    label="Emergency contact phone"
                    value={f.emergencyContactPhone}
                    onChange={update("emergencyContactPhone")}
                  />
                  <Field
                    label="Sponsor name"
                    value={f.sponsorName}
                    onChange={update("sponsorName")}
                  />
                  <Field
                    label="Sponsor contact"
                    value={f.sponsorContact}
                    onChange={update("sponsorContact")}
                  />
                  <Field
                    label="Sponsorship type"
                    value={f.sponsorshipType}
                    onChange={update("sponsorshipType")}
                  />
                  <Field
                    label="Enrollment date"
                    type="date"
                    value={f.enrollmentDate}
                    onChange={update("enrollmentDate")}
                  />
                  <Field
                    label="Program affiliation"
                    value={f.programAffiliation}
                    onChange={update("programAffiliation")}
                  />
                </>
              )}
            </div>
            {error && <div className="alert alert-danger mt-3 mb-0" role="alert">{error}</div>}
            <footer className="participant-modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="btn btn-dark" disabled={saving}>{saving ? "Creating profile…" : "Create profile and QR →"}</button>
            </footer>
          </form>
        )}
      </section>
    </div>
  ), document.body);
}
function Participants({ canManage, user }) {
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [showRegistration, setShowRegistration] = useState(false);
  const [visiblePasscode, setVisiblePasscode] = useState(null);
  const [passcodeMessage, setPasscodeMessage] = useState("");
  const [loadingPasscode, setLoadingPasscode] = useState(false);
  const canViewPasscode = ["church administrator", "system administrator"]
    .includes(String(user?.role || "").toLowerCase());
  const refreshParticipants = useCallback(async () => {
    const data = await apiCall("/participants");
    setList(Array.isArray(data) ? data.filter((participant) => participant.status !== "deleted") : []);
  }, []);
  const update = (key) => (event) =>
    setForm({ ...form, [key]: event.target.value });
  useEffect(() => {
    apiCall("/participants")
      .then((data) => setList(Array.isArray(data) ? data.filter((participant) => participant.status !== "deleted") : []))
      .catch((error) => setMessage(error.message));
  }, []);
  const choose = async (id) => {
    try {
      const data = await apiCall(`/participants/${id}`);
      setSelected(id);
      setVisiblePasscode(null);
      setPasscodeMessage("");
      setForm({
        ...data.participant,
        participantType: data.participant.participant_type,
        ...participantNameFields(data.participant),
        passcode: '',
      });
      setEditing(false);
      setMessage("");
    } catch (error) {
      setMessage(error.message);
    }
  };
  const revealPasscode = async () => {
    setLoadingPasscode(true);
    setPasscodeMessage("");
    try {
      const data = await apiCall(`/participants/${selected}/passcode`);
      setVisiblePasscode(data.passcode);
      if (!data.passcode) {
        setPasscodeMessage("No encrypted passcode is saved for this participant. Edit the profile to set a new one.");
      }
    } catch (error) {
      setPasscodeMessage(error.message);
    } finally {
      setLoadingPasscode(false);
    }
  };
  const save = async (event) => {
    event.preventDefault();
    const eligibilityError = sponsoredChildEligibilityError(form);
    if (eligibilityError) {
      setMessage(eligibilityError);
      return;
    }
    if (!form.firstName?.trim() || !form.lastName?.trim()) {
      setMessage("First name and last name are required.");
      return;
    }
    try {
      const data = await apiCall(`/participants/${selected}`, {
        method: "PUT",
        body: JSON.stringify({ ...form, fullName: composeFullName(form) }),
      });
      setForm({
        ...data.participant,
        participantType: data.participant.participant_type,
        ...participantNameFields(data.participant),
      });
      setEditing(false);
      const fresh = await apiCall('/participants');
      setList(Array.isArray(fresh) ? fresh.filter(p => p.status !== 'deleted') : []);
      setMessage("Participant details saved.");
    } catch (error) {
      setMessage(error.message);
    }
  };

  const deleteParticipant = async () => {
    if (!selected) return;
    if (!window.confirm('Delete participant? This will revoke their QR and mark the participant as deleted.')) return;
    try {
      const headers = { 'Content-Type': 'application/json', ...(localStorage.token ? { Authorization: `Bearer ${localStorage.token}` } : {}) };
      const resp = await fetch(`${api}/participants/${selected}`, { method: 'DELETE', headers });
      const d = await resp.json().catch(() => ({}));
      if (resp.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.dispatchEvent(new Event('auth-expired'));
        return;
      }
      if (!resp.ok) throw new Error(d.error || 'Request failed');
      setSelected(null);
      setForm(null);
      // refresh list using direct fetch to avoid relying on call() which may be in an inconsistent state
      try {
        const headers = { 'Content-Type': 'application/json', ...(localStorage.token ? { Authorization: `Bearer ${localStorage.token}` } : {}) };
        const resp = await fetch(api + '/participants', { headers });
        const listData = await resp.json().catch(() => []);
        setList(Array.isArray(listData) ? listData.filter(p => p.status !== 'deleted') : []);
      } catch (e) {
        // fallback: clear list
        setList([]);
      }
      setMessage('Participant deleted.');
    } catch (err) {
      setMessage(err.message);
    }
  };
  const filtered = list.filter((item) =>
    `${item.participant_code} ${item.participant_type} ${item.gender}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <Title
        e="PARTICIPANTS / RECORDS"
        t="Participant directory."
        d="Review and edit personal and sponsored-child details."
      />
      {canManage && (
        <div className="participant-register-action">
          <button type="button" className="btn btn-dark" onClick={() => setShowRegistration(true)}>
            + Register participant
          </button>
        </div>
      )}
      <div className="row g-4">
        <div className="col-12 col-lg-5">
          <div className="surface directory-panel">
            <input
              className="form-control mb-3"
              placeholder="Search participant records"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {filtered.map((item) => (
              <button
                type="button"
                className={`directory-row ${selected === item.id ? "selected" : ""}`}
                key={item.id}
                onClick={() => choose(item.id)}
              >
                <span>
                  <strong>
                    {item.participant_code || `Participant #${item.id}`}
                  </strong>
                  <small>
                    {item.participant_type === "sponsored_child"
                      ? "Sponsored Child"
                      : "Goer"}{" "}
                    · {item.gender || "Gender not set"}
                  </small>
                </span>
                <span className="directory-arrow">→</span>
              </button>
            ))}
            {!filtered.length && (
              <p className="text-secondary">No participants found.</p>
            )}
          </div>
        </div>
        <div className="col-12 col-lg-7">
          {form && !editing ? (
            <div className="surface participant-qr-card">
              <div className="d-flex justify-content-between align-items-start mb-3">
                <div>
                  <span className="eyebrow">DIGITAL PARTICIPANT ID</span>
                  <h2>{form.participant_code}</h2>
                  <p className="text-secondary mb-0">{form.participantType === "sponsored_child" ? "Sponsored Child" : "Goer"} · {form.status}</p>
                </div>
                {canManage && (
                  <div>
                    <button type="button" className="btn btn-outline-dark me-2" onClick={() => setEditing(true)}>Edit details</button>
                    <button type="button" className="btn btn-danger" onClick={deleteParticipant}>Delete</button>
                  </div>
                )}
              </div>
              {form.qr_code_image ? <img className="participant-qr-image" src={`/${form.qr_code_image}`} alt={`QR code for ${form.participant_code}`} /> : <p className="text-secondary">No active QR code found.</p>}
              {form.qr_code_image && <button type="button" className="btn btn-dark" onClick={() => window.print()}>Print QR card</button>}
              {canViewPasscode && form.participantType === "sponsored_child" && (
                <div className="participant-passcode-panel">
                  <div>
                    <span className="eyebrow">GUARDIAN PORTAL</span>
                    <h3>Child passcode</h3>
                  </div>
                  {visiblePasscode ? (
                    <div className="participant-passcode-value" role="status">
                      <strong>{visiblePasscode}</strong>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => setVisiblePasscode(null)}
                      >
                        Hide
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-outline-dark"
                      onClick={revealPasscode}
                      disabled={loadingPasscode}
                    >
                      {loadingPasscode ? "Loading passcode…" : "View passcode"}
                    </button>
                  )}
                  {passcodeMessage && <p className="text-secondary mb-0" role="status">{passcodeMessage}</p>}
                </div>
              )}
              {!canManage && (
                <div className="profile-grid">
                  {[
                    ["Name", form.fullName],
                    ["Date of birth", form.dateOfBirth],
                    ["Education", form.educationLevel],
                    ["Grade/year", form.gradeLevel],
                    ["College course", form.programCourse],
                    ["Phone", form.phone],
                    ["Address", form.address],
                    ["Emergency contact", form.emergencyContactName],
                    ["Emergency phone", form.emergencyContactPhone],
                    ["Medical conditions", form.medicalConditions],
                    ["Sponsor", form.sponsorName],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <small>{label}</small>
                      <strong>{value || "Not provided"}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : form ? (
            <form className="surface form-surface" onSubmit={save}>
              <div className="d-flex justify-content-between align-items-start mb-3">
                <div>
                  <span className="eyebrow">
                    EDITING {form.participant_code}
                  </span>
                  <h2>Participant details</h2>
                </div>
                <select
                  className="form-select status-select"
                  value={form.status || "active"}
                  onChange={update("status")}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div className="row g-3">
                <Field label="First name" value={form.firstName || ""} onChange={update("firstName")} required />
                <Field label="Middle name (optional)" value={form.middleName || ""} onChange={update("middleName")} />
                <Field label="Last name" value={form.lastName || ""} onChange={update("lastName")} required />
                <Field
                  label="Date of birth"
                  type="date"
                  value={(form.dateOfBirth || "").slice(0, 10)}
                  onChange={update("dateOfBirth")}
                  required={form.participantType === "sponsored_child"}
                />
                <TypeChoice
                  value={form.participantType}
                  onChange={(value) =>
                    setForm({ ...form, participantType: value })
                  }
                />
                <GenderSelect
                  id="edit-gender"
                  value={form.gender}
                  onChange={update("gender")}
                />
                <Field
                  label="Phone"
                  value={form.phone || ""}
                  onChange={update("phone")}
                />
                <Field
                  label="Address"
                  value={form.address || ""}
                  onChange={update("address")}
                />
                {form.participantType === "sponsored_child" && (
                  <>
                    <div className="col-12">
                      <p className="text-secondary mb-0">
                        Sponsored children must be 6–22 years old and select an education level and grade/year. College students must also provide their course.
                      </p>
                    </div>
                    <div className="col-12 col-md-6">
                      <label className="form-label" htmlFor="edit-education-level">Education level</label>
                      <select
                        id="edit-education-level"
                        className="form-select"
                        value={form.educationLevel || ""}
                        onChange={(event) => setForm({
                          ...form,
                          educationLevel: event.target.value,
                          gradeLevel: "",
                          programCourse: event.target.value === "College" ? form.programCourse : "",
                        })}
                        required
                      >
                        <option value="">Select education level</option>
                        {EDUCATION_LEVELS.map((level) => <option key={level}>{level}</option>)}
                      </select>
                    </div>
                    {form.educationLevel && (
                      <div className="col-12 col-md-6">
                        <label className="form-label" htmlFor="edit-grade-level">
                          {form.educationLevel === "College" ? "College year" : "Grade level"}
                        </label>
                        <select
                          id="edit-grade-level"
                          className="form-select"
                          value={form.gradeLevel || ""}
                          onChange={update("gradeLevel")}
                          required
                        >
                          <option value="">Select {form.educationLevel === "College" ? "college year" : "grade level"}</option>
                          {GRADE_LEVELS[form.educationLevel].map((grade) => <option key={grade}>{grade}</option>)}
                        </select>
                      </div>
                    )}
                    {form.educationLevel === "College" && (
                      <Field
                        label="College program or course"
                        value={form.programCourse || ""}
                        onChange={update("programCourse")}
                        required
                      />
                    )}
                    <Field
                      label="Weight"
                      value={form.weight || ""}
                      onChange={update("weight")}
                    />
                    <Field
                      label="Height"
                      value={form.height || ""}
                      onChange={update("height")}
                    />
                    <Field
                      label="Medical conditions"
                      value={form.medicalConditions || ""}
                      onChange={update("medicalConditions")}
                    />
                    <Field
                      label="Emergency contact name"
                      value={form.emergencyContactName || ""}
                      onChange={update("emergencyContactName")}
                    />
                    <Field
                      label="Emergency contact phone"
                      value={form.emergencyContactPhone || ""}
                      onChange={update("emergencyContactPhone")}
                    />
                    <Field
                      label="Sponsor name"
                      value={form.sponsorName || ""}
                      onChange={update("sponsorName")}
                    />
                    <Field
                      label="Sponsor contact"
                      value={form.sponsorContact || ""}
                      onChange={update("sponsorContact")}
                    />
                    <Field
                      label="Sponsorship type"
                      value={form.sponsorshipType || ""}
                      onChange={update("sponsorshipType")}
                    />
                    <Field
                      label="Enrollment date"
                      type="date"
                      value={(form.enrollmentDate || "").slice(0, 10)}
                      onChange={update("enrollmentDate")}
                    />
                    <Field
                      label="Program affiliation"
                      value={form.programAffiliation || ""}
                      onChange={update("programAffiliation")}
                    />
                    <Field
                      label="New portal passcode (optional)"
                      type="password"
                      value={form.passcode || ""}
                      onChange={(event) => setForm({
                        ...form,
                        passcode: event.target.value.replace(/\D/g, "").slice(0, 6),
                      })}
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      minLength={6}
                      placeholder="Leave blank to keep existing; otherwise enter 6 digits"
                    />
                  </>
                )}
              </div>
              <button className="btn btn-dark mt-4">
                Save participant changes →
              </button>
              <button type="button" className="btn btn-link text-secondary mt-4 ms-2" onClick={() => setEditing(false)}>
                Cancel
              </button>
              {message && (
                <div className="alert alert-info mt-3 mb-0">{message}</div>
              )}
            </form>
          ) : (
            <div className="empty-art surface">
              <span className="tile-icon">↗</span>
              <h2>
                Select a participant
                <br />
                to begin editing.
              </h2>
              <p>
                Personal information stays protected while authorized staff keep
                records current.
              </p>
            </div>
          )}
        </div>
      </div>
      {showRegistration && (
        <Register
          onClose={() => setShowRegistration(false)}
          onCreated={refreshParticipants}
        />
      )}
    </>
  );
}
function Camera({ id, onScan, errorMessage = "Camera unavailable. Grant permission or paste the QR payload below." }) {
  const ref = useRef(null);
  const onScanRef = useRef(onScan);
  const [error, setError] = useState("");
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);
  useEffect(() => {
    let active = true;
    let started = false;
    let disposed = false;
    const scanner = new Html5Qrcode(id);
    ref.current = scanner;
    (async () => {
      try {
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 230 },
          (v) => active && onScanRef.current(v),
          () => {},
        );
        started = true;
        if (disposed) {
          await scanner.stop().catch(() => {});
          await scanner.clear().catch(() => {});
        }
      } catch {
        if (active)
          setError(errorMessage);
      }
    })();
    return () => {
      active = false;
      disposed = true;
      if (started) {
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {});
      }
    };
  }, [errorMessage, id]);
  return (
    <>
      <div id={id} className="qr-reader" />
      {error && <div className="alert alert-warning mt-3">{error}</div>}
    </>
  );
}
function PublicHome({ onLogin }) {
  const [screen, setScreen] = useState("home");
  if (screen === "staff") {
    return (
      <Login
        done={onLogin}
        onBack={() => setScreen("home")}
      />
    );
  }
  if (screen === "sponsor" || screen === "goer") {
    return <PublicLookup mode={screen} onBack={() => setScreen("home")} />;
  }
  return (
    <main className="public-home">
      <header className="public-home-header">
        <div className="public-home-brand">
          <img src="/church-logo.png" alt="FMC Field Care logo" />
          <span>FMC FIELD CARE</span>
        </div>
        <span className="public-home-header-note"><span /> A community that cares</span>
      </header>
      <section className="public-home-hero">
        <div className="public-home-intro">
          <span className="public-home-kicker"><span /> FIELD CARE MONITORING SYSTEM</span>
          <h1>Care that<br /><em>moves forward.</em></h1>
          <p>A connected place to support children, welcome our community, and keep every step in view.</p>
        </div>
        <div className="public-home-visual" aria-hidden="true">
          <div className="public-home-orbit public-home-orbit-outer" />
          <div className="public-home-orbit public-home-orbit-inner" />
          <div className="public-home-logo-glow">
            <img src="/church-logo.png" alt="" />
          </div>
          <span className="public-home-visual-label">Every child.<br /><strong>Every journey.</strong></span>
          <span className="public-home-spark public-home-spark-one">✦</span>
          <span className="public-home-spark public-home-spark-two">✦</span>
        </div>
      </section>
      <section className="public-home-portals" aria-labelledby="public-home-portals-title">
        <div className="public-home-section-heading">
          <div>
            <span className="eyebrow">HOW CAN WE HELP?</span>
            <h2 id="public-home-portals-title">Choose your way in</h2>
          </div>
          <span className="public-home-section-caption">Select a portal to continue</span>
        </div>
        <div className="public-access-grid">
        <button className="public-access-card public-access-staff" onClick={() => setScreen("staff")}>
          <span className="public-access-card-top"><span className="public-access-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z" /><path d="M8 9h8M8 13h5M8 17h3" /></svg>
          </span><span className="public-access-number">01 / STAFF</span></span>
          <strong>System Manager</strong>
          <span>Securely sign in to manage the system and support your community.</span>
          <b>Staff sign in <span aria-hidden="true">↗</span></b>
        </button>
        <button className="public-access-card public-access-guardian" onClick={() => setScreen("sponsor")}>
          <span className="public-access-card-top"><span className="public-access-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M20.8 8.7c0 5.4-8.8 11-8.8 11s-8.8-5.6-8.8-11A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.6Z" /><path d="M8.5 12h2l1.2-2.2 1.7 4.4 1.1-2.2h1" /></svg>
          </span><span className="public-access-number">02 / GUARDIAN</span></span>
          <strong>Sponsored Child Guardian</strong>
          <span>See your child’s sponsorship status with their QR code and passcode.</span>
          <b>Check sponsorship <span aria-hidden="true">↗</span></b>
        </button>
        <button className="public-access-card public-access-goer" onClick={() => setScreen("goer")}>
          <span className="public-access-card-top"><span className="public-access-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /><path d="m5 4-2 2m16-2 2 2" /></svg>
          </span><span className="public-access-number">03 / GOER</span></span>
          <strong>Goer</strong>
          <span>Pick up where you left off and see your recent attendance.</span>
          <b>Open Goer portal <span aria-hidden="true">↗</span></b>
        </button>
        </div>
      </section>
      <footer className="public-home-footer">
        <span><span className="public-home-lock" aria-hidden="true">◆</span> Your information is handled with care.</span>
        <span>Participant portals require an active QR code. Guardian access also requires the child’s passcode.</span>
      </footer>
    </main>
  );
}
function PublicLookup({ mode, onBack }) {
  const isSponsor = mode === "sponsor";
  const [payload, setPayload] = useState("");
  const [passcode, setPasscode] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [passcodeOpen, setPasscodeOpen] = useState(false);
  const lastScannedPayload = useRef("");
  const lastScannedAt = useRef(0);
  const onQrScanned = (value) => {
    if (
      isSponsor &&
      value === lastScannedPayload.current &&
      Date.now() - lastScannedAt.current < 2500
    ) return;
    lastScannedPayload.current = value;
    lastScannedAt.current = Date.now();
    setPayload(value);
    setPasscode("");
    setError("");
    if (isSponsor) setPasscodeOpen(true);
  };
  useEffect(() => {
    if (!passcodeOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !loading) {
        setPasscodeOpen(false);
        setPasscode("");
        setError("");
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [passcodeOpen, loading]);
  const verify = async (event) => {
    event.preventDefault();
    if (isSponsor && !/^\d{6}$/.test(passcode)) {
      setError("Enter the 6-digit child passcode.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(`${api}/public/${isSponsor ? "sponsor-status" : "goer-profile"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrPayload: payload.trim(), ...(isSponsor ? { passcode } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to verify this QR code.");
      setResult(data);
      setPasscodeOpen(false);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };
  const submit = (event) => {
    event.preventDefault();
    if (isSponsor) {
      setError("");
      setPasscodeOpen(true);
      return;
    }
    void verify(event);
  };
  return (
    <>
    <main className="public-home public-lookup">
      <button type="button" className="public-lookup-back-button" onClick={onBack}>
        <span aria-hidden="true">←</span>
        Back to home
      </button>
      <section className="public-lookup-heading">
        <span className="eyebrow">{isSponsor ? "GUARDIAN PORTAL" : "GOER PORTAL"}</span>
        <h1>{isSponsor ? "Sponsorship status." : "Your attendance."}</h1>
        <p>{isSponsor
          ? "Scan the Sponsored Child’s QR code. You’ll be asked for the passcode after scanning."
          : "Scan or enter your own active Goer QR code to view your profile and recent attendance."}</p>
      </section>
      {!result ? (
        <form className="surface public-lookup-form" onSubmit={submit}>
          {isSponsor ? (
            <p className="form-label mb-2">Scan the child’s QR code with your camera</p>
          ) : (
            <label className="form-label" htmlFor={`public-qr-${mode}`}>Participant QR code</label>
          )}
          {(!isSponsor || !passcodeOpen) && (
            <Camera
              id={`public-${mode}-qr`}
              onScan={onQrScanned}
              {...(isSponsor ? {
                errorMessage: "Camera unavailable. Grant camera permission to scan the child’s QR code.",
              } : {})}
            />
          )}
          {!isSponsor && (
            <input
              id={`public-qr-${mode}`}
              className="form-control mb-3"
              value={payload}
              onChange={(event) => setPayload(event.target.value)}
              placeholder="Scan the QR code or paste its payload"
              autoComplete="off"
              required
            />
          )}
          {error && <div className="alert alert-danger" role="alert">{error}</div>}
          {!isSponsor && (
            <button className="btn btn-dark w-100" disabled={loading}>
              {loading ? "Verifying…" : "View my profile"}
            </button>
          )}
        </form>
      ) : (
        <section className="surface public-result" aria-live="polite">
          <span className="eyebrow">VERIFIED {isSponsor ? "CHILD" : "GOER"}</span>
          <h2>{isSponsor ? result.child.name : result.goer.name}</h2>
          <p className="text-secondary">Participant ID: {isSponsor ? result.child.participantCode : result.goer.participantCode}</p>
          {isSponsor ? (
            <GuardianSponsoredDetails
              child={result.child}
              qrPayload={payload}
              passcode={passcode}
            />
          ) : (
            <>
              <h3 className="public-attendance-title">Recent attendance</h3>
              {result.attendance.length ? (
                <div className="table-responsive">
                  <table className="table align-middle">
                    <thead><tr><th>Event</th><th>Date</th><th>Location</th><th>Status</th></tr></thead>
                    <tbody>{result.attendance.map((entry, index) => (
                      <tr key={`${entry.checked_in_at}-${index}`}>
                        <td>{entry.event_name}</td>
                        <td>{new Date(entry.checked_in_at).toLocaleString()}</td>
                        <td>{entry.location || "—"}</td>
                        <td>{entry.status}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="text-secondary mb-0">No attendance records are available yet.</p>}
            </>
          )}
          <button className="btn btn-outline-dark mt-4" onClick={() => { setResult(null); setPasscode(""); setPayload(""); setPasscodeOpen(false); lastScannedPayload.current = ""; lastScannedAt.current = 0; }}>Look up another</button>
        </section>
      )}
    </main>
    {isSponsor && passcodeOpen && createPortal(
      <div
        className="guardian-passcode-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setPasscodeOpen(false);
            setPasscode("");
            setError("");
          }
        }}
      >
        <section
          className="guardian-passcode-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="guardian-passcode-title"
        >
          <button
            type="button"
            className="btn-close guardian-passcode-close"
            aria-label="Close passcode dialog"
            disabled={loading}
            onClick={() => {
              setPasscodeOpen(false);
              setPasscode("");
              setError("");
            }}
          />
          <span className="eyebrow">GUARDIAN VERIFICATION</span>
          <h2 id="guardian-passcode-title">Enter child passcode</h2>
          <p className="text-secondary">Enter the 6-digit passcode linked to this QR code.</p>
          <form onSubmit={verify}>
            <label className="form-label" htmlFor="guardian-passcode">6-digit passcode</label>
            <input
              id="guardian-passcode"
              className="form-control mb-3"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={passcode}
              onChange={(event) => setPasscode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              autoComplete="one-time-code"
              autoFocus
              required
            />
            {error && <div className="alert alert-danger" role="alert">{error}</div>}
            <div className="d-flex justify-content-end gap-2">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => {
                  setPasscodeOpen(false);
                  setPasscode("");
                  setError("");
                }}
                disabled={loading}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-dark" disabled={loading || passcode.length !== 6}>
                {loading ? "Verifying…" : "Verify passcode"}
              </button>
            </div>
          </form>
        </section>
      </div>,
      document.body,
    )}
    </>
  );
}
function GuardianSponsoredDetails({ child, qrPayload, passcode }) {
  const [section, setSection] = useState("allowance");
  const [threads, setThreads] = useState([]);
  const [threadId, setThreadId] = useState(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [loadingLetters, setLoadingLetters] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [proof, setProof] = useState(null);
  const selectedThread = threads.find((thread) => Number(thread.id) === Number(threadId));

  const loadThreads = useCallback(async () => {
    const response = await fetch(`${api}/public/sponsor-letters/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qrPayload, passcode }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not load your letters.");
    setThreads(data.threads || []);
    setThreadId((current) => {
      if (current && (data.threads || []).some((thread) => Number(thread.id) === Number(current))) return current;
      return data.threads?.[0]?.id || null;
    });
  }, [qrPayload, passcode]);

  useEffect(() => {
    let active = true;
    fetch(`${api}/public/sponsor-letters/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qrPayload, passcode }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not load your letters.");
        return data;
      })
      .then((data) => {
        if (!active) return;
        setThreads(data.threads || []);
        setThreadId((current) => {
          if (current && (data.threads || []).some((thread) => Number(thread.id) === Number(current))) return current;
          return data.threads?.[0]?.id || null;
        });
      })
      .catch((loadError) => { if (active) setError(loadError.message); })
      .finally(() => { if (active) setLoadingLetters(false); });
    return () => { active = false; };
  }, [qrPayload, passcode]);

  const sendLetter = async (event) => {
    event.preventDefault();
    setSending(true);
    setError("");
    try {
      const response = await fetch(`${api}/public/sponsor-letters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qrPayload,
          passcode,
          ...(selectedThread && selectedThread.status !== "closed" ? { threadId: selectedThread.id } : { subject }),
          message,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not send your letter.");
      setSubject("");
      setMessage("");
      await loadThreads();
      setThreadId(data.threadId);
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
    }
  };

  const viewReceipt = async (record) => {
    setError("");
    setProof(null);
    try {
      const response = await fetch(`${api}/public/sponsor-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrPayload, passcode, disbursementId: record.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load receipt proof.");
      setProof({ ...data, name: record.description || `Receipt for ${record.disbursedOn}` });
    } catch (proofError) {
      setError(proofError.message);
    }
  };

  return (
    <div className="guardian-sponsored-details">
      <div className="public-status">
        <span>Sponsorship status</span>
        <strong>{String(child.lifecycle || child.sponsorStatus).replaceAll("_", " ")}</strong>
      </div>
      <div className="guardian-portal-tabs" role="tablist" aria-label="Sponsored child information">
        <button type="button" className={section === "allowance" ? "active" : ""} role="tab" aria-selected={section === "allowance"} onClick={() => setSection("allowance")}>Allowance & gifts</button>
        <button type="button" className={section === "letters" ? "active" : ""} role="tab" aria-selected={section === "letters"} onClick={() => setSection("letters")}>Letters {threads.length > 0 && <span>{threads.length}</span>}</button>
      </div>
      {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      {section === "allowance" ? (
        <section className="guardian-allowance-section">
          <div className="guardian-allowance-amount"><span>Monthly allowance</span><strong>{formatCurrency(child.monthlyAllowance)}</strong></div>
          <h3 className="public-attendance-title">Allowance and gifts</h3>
          {child.disbursements?.length ? (
            <div className="table-responsive">
              <table className="table align-middle">
                <thead><tr><th>Date</th><th>Amount</th><th>Note</th><th>Proof</th></tr></thead>
                <tbody>{child.disbursements.map((record) => (
                  <tr key={record.id}>
                    <td>{new Date(record.disbursedOn).toLocaleDateString()}</td>
                    <td>{formatCurrency(record.amount)}</td>
                    <td>{record.description || "—"}</td>
                    <td>{record.hasReceipt ? <button className="btn btn-sm btn-outline-primary" onClick={() => viewReceipt(record)}>View receipt</button> : "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="text-secondary">No allowance or gift records are available yet.</p>}
          {proof && (
            <div className="guardian-receipt-preview">
              <div className="guardian-receipt-heading"><strong>{proof.name}</strong><button type="button" className="btn-close" aria-label="Close receipt" onClick={() => setProof(null)} /></div>
              {proof.mimeType.startsWith("image/") ? <img src={`data:${proof.mimeType};base64,${proof.data}`} alt="Receipt proof" /> : <a href={`data:${proof.mimeType};base64,${proof.data}`} target="_blank" rel="noreferrer">Open PDF receipt proof ↗</a>}
            </div>
          )}
        </section>
      ) : (
        <section className="guardian-letters-section">
          <div className="guardian-letter-list">
            {loadingLetters ? <p role="status">Loading your letters...</p> : threads.map((thread) => (
              <button type="button" className={`sponsorship-thread-row ${Number(threadId) === Number(thread.id) ? "selected" : ""}`} key={thread.id} onClick={() => setThreadId(thread.id)}>
                <strong>{thread.subject}</strong><span>{thread.status}</span><small>{new Date(thread.updated_at).toLocaleDateString()}</small>
              </button>
            ))}
            {!loadingLetters && !threads.length && <p className="text-secondary">No letters yet. Send a message to get started.</p>}
          </div>
          {selectedThread && (
            <div className="guardian-thread-conversation">
              <h3>{selectedThread.subject}</h3>
              <div className="sponsorship-messages">{selectedThread.messages.map((entry) => (
                <div className={`sponsorship-message ${entry.sender_type}`} key={entry.id}>
                  <span>{entry.sender_type === "staff" ? "Church staff" : "You"} · {new Date(entry.created_at).toLocaleString()}</span>
                  <p>{entry.message}</p>
                </div>
              ))}</div>
            </div>
          )}
          <form className="guardian-letter-form" onSubmit={sendLetter}>
            {(!selectedThread || selectedThread.status === "closed") && (
              <div><label className="form-label" htmlFor="guardian-letter-subject">Subject</label><input id="guardian-letter-subject" className="form-control" maxLength={160} required value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="What would you like to ask?" /></div>
            )}
            <div><label className="form-label" htmlFor="guardian-letter-message">{selectedThread && selectedThread.status !== "closed" ? "Reply" : "Message"}</label><textarea id="guardian-letter-message" className="form-control" rows="4" maxLength={5000} required value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write your message to the church team" /></div>
            <button className="btn btn-dark" disabled={sending}>{sending ? "Sending…" : selectedThread && selectedThread.status !== "closed" ? "Send reply" : "Send letter"}</button>
          </form>
        </section>
      )}
    </div>
  );
}
function Scanner({ portal = false }) {
  const [payload, setPayload] = useState("");
  const [toast, setToast] = useState(null);
  const [pass, setPass] = useState("");
  const [requiresPasscode, setRequiresPasscode] = useState(false);
  const [profile, setProfile] = useState(null);
  const [event, setEvent] = useState("custom");
  const [attendanceAction, setAttendanceAction] = useState("check_in");
  const [events, setEvents] = useState([]);
  const portalBusy = useRef(false);
  const checkinBusy = useRef(false);

  useEffect(() => {
    if (!portal) apiCall("/events").then(setEvents).catch(() => {});
  }, [portal]);
  const selectedEvent = events.find((item) => String(item.id) === event);
  const eventName = selectedEvent?.name || "Sunday service";
  const eventLocation = selectedEvent?.location || null;

  const showToast = (text, type = "info", ms = 2500) => {
    setToast({ text, type });
    setTimeout(() => setToast(null), ms);
  };

  const openPortal = async (value, passcode = "") => {
    const portalData = await apiCall("/portal/profile", {
      method: "POST",
      body: JSON.stringify({ qrPayload: value, passcode }),
    });
    setProfile({ ...portalData.participant, attendance: portalData.attendance });
  };
  const postAttendance = async (value) => {
    const headers = { "Content-Type": "application/json", ...(localStorage.token ? { Authorization: `Bearer ${localStorage.token}` } : {}) };
    const resp = await fetch(api + "/checkin", {
      method: "POST",
      headers,
      body: JSON.stringify({ qrPayload: value, eventName, location: eventLocation, action: attendanceAction }),
    });
    const result = await resp.json().catch(() => ({}));
    if (resp.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.dispatchEvent(new Event("auth-expired"));
    }
    if (!resp.ok) {
      const error = new Error(result.error || "Could not record attendance.");
      error.status = resp.status;
      throw error;
    }
    if (result.status === "checked_out") showToast("Check-out recorded.", "success");
    else if (result.status === "duplicate") showToast("Already checked in today for this event.", "warning");
    else showToast("Check-in recorded.", "success");
  };
  const handleAttendance = async (value) => {
    try {
      await postAttendance(value);
    } catch (error) {
      if (attendanceAction === "check_in" && (!error.status || error.status >= 500)) {
        try {
          const queued = await queueCheckin({
            qrPayload: value,
            eventName,
            location: eventLocation,
            action: "check_in",
          });
          showToast(
            queued ? "Offline: check-in queued for sync." : "Check-in already queued for today.",
            queued ? "info" : "warning",
          );
        } catch {
          showToast(error.message || "Could not record attendance.", "danger");
        }
        return;
      }
      if (attendanceAction === "check_out" && !error.status) {
        showToast("Could not confirm check-out. Check the event attendance record before retrying.", "warning", 5000);
        return;
      }
      showToast(error.message || "Could not record attendance.", "danger", 4000);
    }
  };
  const scan = async (v) => {
    // Always update payload input so it can be pasted/seen
    setPayload(v);

    // Portal mode: verify and open profile (requires passcode handling)
    if (portal) {
      if (portalBusy.current) return;
      portalBusy.current = true;
      try {
        await openPortal(v);
      } catch (error) {
        const sponsored = error.message === "Sponsored Child passcode required";
        setRequiresPasscode(sponsored);
        showToast(sponsored ? "Sponsored Child detected. Enter the passcode to continue." : error.message, sponsored ? "warning" : "danger");
      } finally {
        portalBusy.current = false;
      }
      return;
    }

    // Station mode: the selected action determines whether this scan checks in or out.
    if (checkinBusy.current) return;
    checkinBusy.current = true;
    try {
      await handleAttendance(v);
    } finally {
      // allow next scan after short cooldown to avoid duplicate scans
      setTimeout(() => {
        checkinBusy.current = false;
      }, 1500);
    }
  };
  const send = async () => {
    try {
      if (portal) {
        await openPortal(payload, pass);
      } else {
        await handleAttendance(payload);
      }
    } catch (x) {
      setRequiresPasscode(x.message === "Sponsored Child passcode required");
      showToast(x.message, x.message === "Sponsored Child passcode required" ? "warning" : "danger");
    }
  };
  useEffect(() => {
    if (!portal) {
      let sync = () =>
        syncQueuedCheckins((x) =>
          apiCall("/checkin", {
            method: "POST",
            body: JSON.stringify({ ...x, action: "check_in" }),
          }),
        );
      window.addEventListener("online", sync);
      return () => window.removeEventListener("online", sync);
    }
  }, [portal]);
  if (profile)
    return (
      <>
        <Title
          e="VERIFIED PROFILE"
          t={profile.fullName || `Participant #${profile.id}`}
          d={profile.participant_type === "sponsored_child" ? "Access granted through QR and passcode verification." : "Access granted through QR verification."}
        />
        <div className="surface profile-card">
          <h2>{profile.fullName || "Participant profile"}</h2>
              <p className="text-secondary">Verified participant portal</p>
          <div className="profile-grid">
            <div>
              <small>Phone</small>
              <strong>{profile.phone || "Not provided"}</strong>
            </div>
            <div>
              <small>Gender</small>
              <strong>{profile.gender || "Not provided"}</strong>
            </div>
            <div>
              <small>Address</small>
              <strong>{profile.address || "Not provided"}</strong>
            </div>
            <div>
              <small>Status</small>
              <strong>{profile.status}</strong>
            </div>
          </div>
          {profile.participant_type === "sponsored_child" && <div className="portal-details mt-4">
            <h3>Sponsored Child information</h3>
            <div className="profile-grid">
              <div><small>Weight</small><strong>{profile.weight || "Not provided"}<small> KG</small></strong></div>
              <div><small>Height</small><strong>{profile.height || "Not provided"}<small> CM</small></strong></div>
              <div><small>Medical conditions</small><strong>{profile.medicalConditions || "None"}</strong></div>
              <div><small>Emergency contact</small><strong>{profile.emergencyContactName || "Not provided"}</strong></div>
              <div><small>Emergency phone</small><strong>{profile.emergencyContactPhone || "Not provided"}</strong></div>
              <div><small>Sponsor</small><strong>{profile.sponsorName || "Not provided"}</strong></div>
              <div><small>Sponsor contact</small><strong>{profile.sponsorContact || "Not provided"}</strong></div>
              <div><small>Sponsorship type</small><strong>{profile.sponsorshipType || "Not provided"}</strong></div>
              <div><small>Education</small><strong>{profile.educationLevel || "Not provided"}</strong></div>
              <div><small>Grade/year</small><strong>{profile.gradeLevel || "Not provided"}</strong></div>
              {profile.educationLevel === "College" && <div><small>College course</small><strong>{profile.programCourse || "Not provided"}</strong></div>}
              <div><small>Enrollment date</small><strong>{profile.enrollmentDate || "Not provided"}</strong></div>
              <div><small>Program affiliation</small><strong>{profile.programAffiliation || "Not provided"}</strong></div>
            </div>
          </div>}
          <h3 className="mt-4">Recent attendance</h3>
          <div className="table-responsive"><table className="table"><thead><tr><th>Event</th><th>Checked in</th><th>Checked out</th></tr></thead><tbody>{(profile.attendance || []).map((row, index) => <tr key={index}><td>{row.event_name}</td><td>{row.checked_in_at ? new Date(row.checked_in_at).toLocaleString() : "—"}</td><td>{row.checked_out_at ? new Date(row.checked_out_at).toLocaleString() : "—"}</td></tr>)}</tbody></table></div>
        </div>
        {toast && (
          <div style={{position: 'fixed', right: 20, bottom: 20, zIndex: 2000, padding: '10px 14px', borderRadius: 8, color: '#fff', backgroundColor: toast.type === 'success' ? '#28a745' : toast.type === 'warning' ? '#ff9f1c' : toast.type === 'danger' ? '#dc3545' : '#0d6efd', boxShadow: '0 4px 12px rgba(0,0,0,0.15)'}}>
            {toast.text}
          </div>
        )}
      </>
    );
  return (
    <>
      <Title
        e={portal ? "SPONSORED CHILD PORTAL" : "CHECK-IN STATION"}
        t={portal ? "A private window into care." : "Make every arrival count."}
        d="Use the device camera or paste a QR payload."
      />
      <div className="row g-4">
        <div className="col-12 col-md-6">
          <div className="surface scanner-card">
            <Camera
              id={portal ? "portal-camera" : "station-camera"}
              onScan={scan}
            />
            <input
              className="form-control mt-3"
              placeholder="Or paste QR payload"
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
            />
          </div>
        </div>
        <div className="col-12 col-md-6">
          <div className="surface form-surface">
            {portal ? (
              <>
                {requiresPasscode && <input className="form-control mb-3" type="password" placeholder="Sponsored Child passcode" value={pass} onChange={(e) => setPass(e.target.value)} />}
              </>
            ) : (
              <>
                <div className="col-12">
                  <label className="form-label">Event</label>
                  <select className="form-select" value={event} onChange={(e) => setEvent(e.target.value)}>
                    <option value="custom">Sunday service (custom)</option>
                    {events.map((item) => <option key={item.id} value={String(item.id)}>{item.name} · {new Date(item.starts_at).toLocaleString()}</option>)}
                  </select>
                </div>
                {selectedEvent?.location && (
                  <p className="text-secondary small mt-3 mb-0">
                    Event location: <strong>{selectedEvent.location}</strong>
                  </p>
                )}
                <div className="col-12">
                  <label className="form-label" htmlFor="attendance-action">Attendance action</label>
                  <select
                    id="attendance-action"
                    className="form-select"
                    value={attendanceAction}
                    onChange={(event) => setAttendanceAction(event.target.value)}
                  >
                    <option value="check_in">Check in</option>
                    <option value="check_out">Check out</option>
                  </select>
                  <small className="text-secondary">
                    Choose the action before scanning. Check-out requires an active check-in for this event today.
                  </small>
                </div>
              </>
            )}
            <button
              className="btn btn-dark mt-3 w-100"
              disabled={!payload}
              onClick={send}
            >
              {portal ? "Verify and open profile" : attendanceAction === "check_out" ? "Record check-out" : "Record check-in"} →
            </button>
            {/* Toast handled separately */}
          </div>
        </div>
      </div>
      {toast && (
        <div style={{position: 'fixed', right: 20, bottom: 20, zIndex: 2000, padding: '10px 14px', borderRadius: 8, color: '#fff', backgroundColor: toast.type === 'success' ? '#28a745' : toast.type === 'warning' ? '#ff9f1c' : toast.type === 'danger' ? '#dc3545' : '#0d6efd', boxShadow: '0 4px 12px rgba(0,0,0,0.15)'}}>
          {toast.text}
        </div>
      )}
    </>
  );
}
const MAX_EVENT_PHOTOS = 5;
const MAX_EVENT_PHOTO_BYTES = 4 * 1024 * 1024;
const EVENT_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function encodeEventPhotos(files) {
  return Promise.all(files.map((file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      fileName: file.name,
      data: reader.result,
    });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  })));
}

function Events({ canManage }) {
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [eventPhotos, setEventPhotos] = useState([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [newEventPhotos, setNewEventPhotos] = useState([]);
  const [photosToUpload, setPhotosToUpload] = useState([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [createPhotoError, setCreatePhotoError] = useState("");
  const [uploadPhotoError, setUploadPhotoError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ name: "", description: "", startsAt: "", endsAt: "", location: "" });
  const createPhotoInput = useRef(null);
  const modalPhotoInput = useRef(null);
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  const load = () => apiCall("/events").then(setEvents).catch((error) => setMessage(error.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!selected) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selected]);
  const create = async (event) => {
    event.preventDefault();
    try {
      const validationError = validatePhotoSelection(newEventPhotos);
      if (validationError) {
        setCreatePhotoError(validationError);
        return;
      }
      const photos = await encodeEventPhotos(newEventPhotos);
      await apiCall("/events", { method: "POST", body: JSON.stringify({ ...form, photos }) });
      setForm({ name: "", description: "", startsAt: "", endsAt: "", location: "" });
      setNewEventPhotos([]);
      setCreatePhotoError("");
      if (createPhotoInput.current) createPhotoInput.current.value = "";
      setMessage("Event schedule created.");
      await load();
    } catch (error) { setMessage(error.message); }
  };
  const viewAttendance = async (id) => {
    setSelected({ id, name: events.find((item) => item.id === id)?.name || "Event" });
    setAttendance([]);
    setEventPhotos([]);
    setPhotosToUpload([]);
    setAttendanceLoading(true);
    setUploadPhotoError("");
    try {
      const [data, photos] = await Promise.all([
        apiCall(`/events/${id}/attendance`),
        apiCall(`/events/${id}/photos`),
      ]);
      setSelected(data.event);
      setAttendance(data.attendance);
      setEventPhotos(photos);
    } catch (error) { setMessage(error.message); }
    finally { setAttendanceLoading(false); }
  };
  const validatePhotoSelection = (files, existingBytes = 0) => {
    const picked = Array.from(files || []);
    if (picked.length > MAX_EVENT_PHOTOS) return `Choose no more than ${MAX_EVENT_PHOTOS} photos.`;
    const unsupported = picked.find((file) => !EVENT_PHOTO_TYPES.has(file.type));
    if (unsupported) return "Photos must be JPG, PNG, or WebP images.";
    const tooLarge = picked.find((file) => file.size > MAX_EVENT_PHOTO_BYTES);
    if (tooLarge) return `${tooLarge.name} is larger than 4 MB.`;
    if (existingBytes + picked.reduce((total, file) => total + file.size, 0) > 15 * 1024 * 1024) {
      return "The selected photos must total no more than 15 MB.";
    }
    return "";
  };
  const uploadEventPhotos = async (event) => {
    event.preventDefault();
    setUploadPhotoError("");
    const validationError = validatePhotoSelection(
      photosToUpload,
      eventPhotos.reduce((total, photo) => total + photo.byteSize, 0),
    );
    if (validationError) {
      setUploadPhotoError(validationError);
      return;
    }
    if (eventPhotos.length + photosToUpload.length > MAX_EVENT_PHOTOS) {
      setUploadPhotoError(`Each event can have no more than ${MAX_EVENT_PHOTOS} photos.`);
      return;
    }
    if (!photosToUpload.length) {
      setUploadPhotoError("Choose at least one photo to upload.");
      return;
    }
    setUploadingPhotos(true);
    try {
      const photos = await encodeEventPhotos(photosToUpload);
      await apiCall(`/events/${selected.id}/photos`, {
        method: "POST",
        body: JSON.stringify({ photos }),
      });
      const updatedPhotos = await apiCall(`/events/${selected.id}/photos`);
      setEventPhotos(updatedPhotos);
      setPhotosToUpload([]);
      setUploadPhotoError("");
      if (modalPhotoInput.current) modalPhotoInput.current.value = "";
      await load();
    } catch (error) {
      setUploadPhotoError(error.message);
    } finally {
      setUploadingPhotos(false);
    }
  };
  const upcoming = events.filter((item) => new Date(item.starts_at) >= new Date());
  const past = events.filter((item) => new Date(item.starts_at) < new Date());
  const EventRow = ({ item }) => (
    <div className="risk-row">
      <div><strong>{item.name}</strong><small>{new Date(item.starts_at).toLocaleString()} {item.location ? `· ${item.location}` : ""}</small></div>
      <button className="btn btn-sm btn-outline-dark" onClick={() => viewAttendance(item.id)}>View attendance</button>
    </div>
  );
  return <>
    <Title e="EVENTS / SCHEDULE" t="Plan every gathering." d="Create event schedules and review attendance from completed events." />
    <div className="row g-4">
      {canManage && <div className="col-12 col-lg-5">
        <form className="surface form-surface" onSubmit={create}>
          <h2 className="mb-3">Create event</h2>
          <Field label="Event name" value={form.name} onChange={update("name")} required />
          <Field label="Location" value={form.location} onChange={update("location")} />
          <Field label="Starts" type="datetime-local" value={form.startsAt} onChange={update("startsAt")} required />
          <Field label="Ends" type="datetime-local" value={form.endsAt} onChange={update("endsAt")} />
          <div className="mb-3"><label className="form-label">Description</label><textarea className="form-control" rows="3" value={form.description} onChange={update("description")} /></div>
          <div className="mb-3">
            <label className="form-label" htmlFor="event-photos">Event photos (optional, up to 5)</label>
            <input
              ref={createPhotoInput}
              id="event-photos"
              className="form-control"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                setCreatePhotoError(validatePhotoSelection(files));
                setNewEventPhotos(files);
              }}
            />
            <small className="text-secondary">JPG, PNG, or WebP · up to 4 MB each, 15 MB total</small>
            {newEventPhotos.length > 0 && <div className="event-selected-files">{newEventPhotos.map((file) => <span key={`${file.name}-${file.lastModified}`}>{file.name}</span>)}</div>}
            {createPhotoError && <div className="alert alert-danger mt-2 mb-0" role="alert">{createPhotoError}</div>}
          </div>
          <button className="btn btn-dark">Save event schedule →</button>
          {message && <div className="alert alert-info mt-3 mb-0">{message}</div>}
        </form>
      </div>}
      <div className={canManage ? "col-12 col-lg-7" : "col-12"}>
        <div className="surface table-surface events-list-surface"><h2>Upcoming events</h2>{upcoming.length ? upcoming.map((item) => <EventRow item={item} key={item.id} />) : <p className="text-secondary py-3">No upcoming events.</p>}</div>
        <div className="surface table-surface events-list-surface mt-4"><h2>Past events</h2>{past.length ? past.map((item) => <EventRow item={item} key={item.id} />) : <p className="text-secondary py-3">No past events.</p>}</div>
      </div>
    </div>
    {selected && createPortal(
      <div className="event-modal-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setSelected(null);
      }}>
        <section className="event-modal" role="dialog" aria-modal="true" aria-labelledby="event-attendance-title">
          <header className="event-modal-header">
            <div>
              <span className="eyebrow">EVENT DETAILS</span>
              <h2 id="event-attendance-title">{selected.name} attendance</h2>
              <p>{selected.starts_at ? new Date(selected.starts_at).toLocaleString() : "Loading event details"}{selected.location ? ` · ${selected.location}` : ""}</p>
            </div>
            <button type="button" className="btn-close" aria-label="Close attendance details" onClick={() => setSelected(null)} />
          </header>
          {attendanceLoading ? (
            <div className="event-modal-loading" role="status">Loading attendance and event photos…</div>
          ) : (
            <>
              <div className="event-attendance-heading"><h3>Attendance</h3><span>{attendance.length} records</span></div>
              {attendance.length ? (
                <div className="table-responsive event-attendance-table">
                  <table className="table">
                    <thead><tr><th>Participant name</th><th>Code</th><th>Type</th><th>Location</th><th>Checked in</th><th>Checked out</th></tr></thead>
                    <tbody>{attendance.map((row) => (
                      <tr key={row.id}>
                        <td>{row.participant_name || "Name unavailable"}</td>
                        <td>{row.participant_code || `Participant #${row.participant_id}`}</td>
                        <td>{row.participant_type}</td>
                        <td>{row.location || "—"}</td>
                        <td>{new Date(row.checked_in_at).toLocaleString()}</td>
                        <td>{row.checked_out_at ? new Date(row.checked_out_at).toLocaleString() : "—"}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="event-empty-state">No attendance has been recorded for this event yet.</p>}
              <section className="event-photo-section">
                <div className="event-attendance-heading"><h3>Event photos</h3><span>{eventPhotos.length} / {MAX_EVENT_PHOTOS}</span></div>
                {eventPhotos.length ? (
                  <div className="event-photo-grid">
                    {eventPhotos.map((photo) => (
                      <figure key={photo.id}>
                        <img src={`data:${photo.mimeType};base64,${photo.data}`} alt={`${selected.name} — ${photo.fileName}`} />
                        <figcaption>{photo.fileName}</figcaption>
                      </figure>
                    ))}
                  </div>
                ) : <p className="event-empty-state">No photos uploaded for this event yet.</p>}
                {canManage && eventPhotos.length < MAX_EVENT_PHOTOS && (
                  <form className="event-photo-upload" onSubmit={uploadEventPhotos}>
                    <label className="form-label" htmlFor="event-modal-photos">Add photos to this event</label>
                    <input
                      ref={modalPhotoInput}
                      id="event-modal-photos"
                      className="form-control"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={(event) => {
                        const files = Array.from(event.target.files || []);
                        const remaining = MAX_EVENT_PHOTOS - eventPhotos.length;
                        const validationError = files.length > remaining
                          ? `This event can have ${remaining} more photo${remaining === 1 ? "" : "s"}.`
                          : validatePhotoSelection(files);
                        const currentBytes = eventPhotos.reduce((total, photo) => total + photo.byteSize, 0);
                        setUploadPhotoError(validationError || validatePhotoSelection(files, currentBytes));
                        setPhotosToUpload(files);
                      }}
                    />
                    <small>JPG, PNG, or WebP · up to 4 MB each, 15 MB total</small>
                    {photosToUpload.length > 0 && <div className="event-selected-files">{photosToUpload.map((file) => <span key={`${file.name}-${file.lastModified}`}>{file.name}</span>)}</div>}
                    {uploadPhotoError && <div className="alert alert-danger mt-2 mb-0" role="alert">{uploadPhotoError}</div>}
                    <button className="btn btn-primary mt-3" disabled={uploadingPhotos || attendanceLoading}>
                      {uploadingPhotos ? "Uploading…" : "Upload photos"}
                    </button>
                  </form>
                )}
              </section>
            </>
          )}
        </section>
      </div>,
      document.body,
    )}
  </>;
}
function Analytics() {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState("all");
  const [validation, setValidation] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const canvas = useRef(null);
  useEffect(() => {
    let mounted = true;
    Promise.all([
      apiCall("/risk-scores"),
      apiCall("/risk-scores/validation"),
    ])
      .then(([riskScores, validationReport]) => {
        if (!mounted) return;
        setRows(riskScores);
        setValidation(validationReport);
      })
      .catch((loadError) => {
        if (mounted) setError(loadError.message);
      });
    return () => { mounted = false; };
  }, []);
  const refreshModel = async () => {
    setRefreshing(true);
    setError("");
    try {
      const report = await apiCall("/risk-scores/refresh", { method: "POST" });
      setValidation(report.validation);
      setRows(await apiCall("/risk-scores"));
    } catch (refreshError) {
      setError(refreshError.message);
    } finally {
      setRefreshing(false);
    }
  };
  let data = rows.filter((r) => filter === "all" || r.risk_level === filter);
  useEffect(() => {
    if (!canvas.current) return;
    let c = new Chart(canvas.current, {
      type: "bar",
      data: {
        labels: data.slice(0, 10).map((r) => r.participant_id),
        datasets: [
          {
            data: data.slice(0, 10).map((r) => r.risk_score),
            backgroundColor: "#e7794f",
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, max: 100 } },
      },
    });
    return () => c.destroy();
  }, [data]);
  return (
    <>
      <Title
        e="ATTENDANCE ANALYTICS"
        t="Review attendance patterns."
        d="The system tests whether attendance history predicts a 30-day inactivity outcome. Predictions remain labeled unvalidated unless the chronological holdout passes the published data and metric gates."
      />
      <section className={`alert ${validation?.status === "validated" ? "alert-success" : "alert-warning"}`} role="status">
        <div className="d-flex flex-wrap justify-content-between align-items-start gap-3">
          <div>
            <strong>
              {validation?.status === "validated"
                ? "Temporal evaluation passed"
                : validation?.status === "insufficient_or_failed"
                  ? "Predictions are not validated"
                  : "No evaluation has been recorded"}
            </strong>
            <p className="mb-1 mt-2">{validation?.target || "Outcome: no attendance check-in in the 30 days after a score date."}</p>
            {validation?.evaluatedAt && (
              <small>Last evaluated {new Date(validation.evaluatedAt).toLocaleString()}</small>
            )}
          </div>
          <button className="btn btn-dark" type="button" disabled={refreshing} onClick={refreshModel}>
            {refreshing ? "Evaluating history…" : "Evaluate and refresh scores"}
          </button>
        </div>
        {error && <p className="mb-0 mt-3" role="alert">{error}</p>}
        {validation?.metrics && validation?.baseline && (
          <div className="mt-3">
            <strong>Held-out results</strong>
            <p className="mb-1">
              Training: {validation.counts.trainingExamples} snapshots from {validation.counts.trainingParticipants} participants · test: {validation.counts.testExamples} snapshots from {validation.counts.testParticipants} participants
              ({validation.counts.testPositive} inactive, {validation.counts.testNegative} attended).
            </p>
            <p className="mb-1">
              PR-AUC {validation.metrics.prAuc} vs prevalence baseline {validation.baseline.prevalence} ·
              Brier {validation.metrics.brierScore} vs baseline {validation.baseline.brierScore} ·
              calibration error {validation.metrics.expectedCalibrationError} vs baseline {validation.baseline.expectedCalibrationError}.
            </p>
            <small>
              {validation.evaluationMethod}. A passing retrospective evaluation is not a guarantee of future accuracy; review results with staff and never use scores as the sole basis for decisions about a child.
            </small>
          </div>
        )}
        {validation?.reasons?.length > 0 && (
          <ul className="mb-0 mt-3">
            {validation.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
      </section>
      <div className="filter-bar btn-group">
        {["all", "high", "medium", "low"].map((x) => (
          <button
            key={x}
            className={`btn ${filter === x ? "btn-dark" : "btn-outline-secondary"}`}
            onClick={() => setFilter(x)}
          >
            {x}
          </button>
        ))}
      </div>
      <div className="row g-4">
        <div className="col-12 col-lg-7">
          <div className="surface chart-surface">
            <canvas ref={canvas} />
          </div>
        </div>
        <div className="col-12 col-lg-5">
          <div className="surface table-surface">
            <h2>Attendance indicator register</h2>
            {data.map((r, i) => (
              <div className="risk-row" key={i}>
                <div>
                  <strong>Participant #{r.participant_id}</strong>
                  <small>{r.model_version}</small>
                </div>
                <Badge level={r.risk_level} />
                <strong className="risk-score">
                  {Number(r.risk_score).toFixed(0)}
                </strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
function Reports({ user }) {
  const canExportChildUpdates = canAccessPermission("sponsorship:view", user);
  const [range, setRange] = useState("weekly");
  const [children, setChildren] = useState([]);
  const [selectedChildId, setSelectedChildId] = useState("");
  const [childExportError, setChildExportError] = useState("");
  const [childExportBusy, setChildExportBusy] = useState(false);
  useEffect(() => {
    if (!canExportChildUpdates) return;
    apiCall("/sponsorship/children")
      .then(setChildren)
      .catch((loadError) => setChildExportError(loadError.message));
  }, [canExportChildUpdates]);
  const download = async (format) => {
    let r = await fetch(
      `${api}/reports/attendance?range=${range}&format=${format}`,
      { headers: { Authorization: `Bearer ${localStorage.token}` } },
    );
    let u = URL.createObjectURL(await r.blob());
    let a = document.createElement("a");
    a.href = u;
    a.download = `attendance-${range}.${format}`;
    a.click();
    URL.revokeObjectURL(u);
  };
  const downloadChildUpdates = async () => {
    setChildExportError("");
    setChildExportBusy(true);
    try {
      const response = await fetch(
        `${api}/reports/sponsored-child-updates?participantId=${encodeURIComponent(selectedChildId)}`,
        { headers: { Authorization: `Bearer ${localStorage.token}` } },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Could not export sponsored-child updates.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `sponsored-child-updates-${selectedChildId}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setChildExportError(exportError.message);
    } finally {
      setChildExportBusy(false);
    }
  };
  return (
    <>
      <Title
        e="REPORTING"
        t="Turn activity into clarity."
        d="Export attendance records and, with sponsored-care access, child growth and activity history."
      />
      <div className="surface report-panel">
        <label className="form-label">Reporting range</label>
        <select
          className="form-select mb-3"
          value={range}
          onChange={(e) => setRange(e.target.value)}
        >
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        <button className="btn btn-dark me-2" onClick={() => download("pdf")}>
          Download PDF ↓
        </button>
        <button
          className="btn btn-outline-dark"
          onClick={() => download("csv")}
        >
          Download CSV ↓
        </button>
      </div>
      {canExportChildUpdates && (
        <div className="surface report-panel mt-4">
          <h2>Sponsored-child monitoring</h2>
          <p>Export dated growth, activity, and care-note records for one child.</p>
          {childExportError && <div className="alert alert-danger" role="alert">{childExportError}</div>}
          <label className="form-label" htmlFor="child-updates-report">Sponsored child</label>
          <select
            id="child-updates-report"
            className="form-select mb-3"
            value={selectedChildId}
            onChange={(event) => setSelectedChildId(event.target.value)}
          >
            <option value="">Select a child</option>
            {children.map((child) => (
              <option key={child.id} value={child.id}>{child.name} ({child.participantCode})</option>
            ))}
          </select>
          <button
            className="btn btn-outline-dark"
            disabled={!selectedChildId || childExportBusy}
            onClick={downloadChildUpdates}
          >
            {childExportBusy ? "Preparing CSV…" : "Download child updates CSV ↓"}
          </button>
        </div>
      )}
    </>
  );
}
function AuditHistory() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const entriesLength = useRef(0);
  const pageSize = 50;

  const loadEntries = useCallback(async (append = false) => {
    try {
      const offset = append ? entriesLength.current : 0;
      const result = await apiCall(`/audit-logs?limit=${pageSize}&offset=${offset}`);
      entriesLength.current = append ? offset + result.entries.length : result.entries.length;
      setEntries((previous) => append ? [...previous, ...result.entries] : result.entries);
      setHasMore(result.entries.length === pageSize);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const retryLoading = () => {
    setLoading(true);
    setError("");
    loadEntries(entries.length > 0);
  };

  return (
    <>
      <Title
        e="ADMINISTRATION"
        t="Audit history."
        d="Review account, participant, event, and check-in changes."
      />
      <div className="surface table-surface">
        <div className="panel-title">
          <h2>Recent activity</h2>
          <span>{entries.length} records loaded</span>
        </div>
        {error && (
          <div className="alert alert-danger" role="alert">
            {error}
            <button className="btn btn-sm btn-outline-danger ms-3" onClick={retryLoading}>
              Retry
            </button>
          </div>
        )}
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Role</th>
                <th>Action</th>
                <th>Record</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const details = entry.details && typeof entry.details === "object"
                  ? entry.details
                  : {};
                const detailText = details.changedFields?.join(", ") || details.eventName || "—";
                return (
                  <tr key={entry.id}>
                    <td>{new Date(entry.created_at).toLocaleString()}</td>
                    <td>{entry.username}</td>
                    <td>{entry.role}</td>
                    <td>{entry.action}</td>
                    <td>{entry.entity_type}{entry.entity_id ? ` #${entry.entity_id}` : ""}</td>
                    <td>{detailText}</td>
                  </tr>
                );
              })}
              {!entries.length && !loading && (
                <tr><td colSpan="6" className="text-secondary">No audit activity recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {loading && <p role="status" className="text-secondary">Loading audit history...</p>}
        {hasMore && !loading && (
          <button className="btn btn-outline-dark" onClick={() => {
            setLoading(true);
            setError("");
            loadEntries(true);
          }}>
            Load more
          </button>
        )}
      </div>
    </>
  );
}
const SPONSOR_LIFECYCLE = ["new", "active", "deceased", "graduated"];
const formatCurrency = (value) => new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "PHP",
}).format(Number(value || 0));

function SponsoredCare({ user }) {
  const canManage = canAccessPermission("sponsorship:manage", user);
  const [children, setChildren] = useState([]);
  const [letters, setLetters] = useState([]);
  const [selectedChildId, setSelectedChildId] = useState(null);
  const [disbursements, setDisbursements] = useState([]);
  const [childUpdates, setChildUpdates] = useState([]);
  const [staffProof, setStaffProof] = useState(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [monthlyAllowance, setMonthlyAllowance] = useState("0");
  const [gift, setGift] = useState({ amount: "", disbursedOn: new Date().toISOString().slice(0, 10), description: "", receiptData: "" });
  const [childUpdate, setChildUpdate] = useState({
    type: "growth",
    recordedOn: new Date().toISOString().slice(0, 10),
    activity: "",
    heightCm: "",
    weightKg: "",
    note: "",
  });
  const [receiptName, setReceiptName] = useState("");
  const [reply, setReply] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    Promise.all([apiCall("/sponsorship/children"), apiCall("/sponsorship/letters")])
      .then(([childRows, letterRows]) => {
        if (!mounted) return;
        setChildren(childRows);
        setLetters(letterRows);
      })
      .catch((loadError) => {
        if (mounted) setError(loadError.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  const selectChild = async (child) => {
    setSelectedChildId(child.id);
    setStatus(child.lifecycle);
    setMonthlyAllowance(String(child.monthlyAllowance));
    setDisbursements([]);
    setChildUpdates([]);
    setStaffProof(null);
    setSelectedThreadId(null);
    setError("");
    try {
      const [records, updates] = await Promise.all([
        apiCall(`/sponsorship/children/${child.id}/disbursements`),
        apiCall(`/sponsorship/children/${child.id}/updates`),
      ]);
      setDisbursements(records);
      setChildUpdates(updates);
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  const addChildUpdate = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      await apiCall(`/sponsorship/children/${selectedChildId}/updates`, {
        method: "POST",
        body: JSON.stringify(childUpdate),
      });
      setChildUpdate({
        type: "growth",
        recordedOn: new Date().toISOString().slice(0, 10),
        activity: "",
        heightCm: "",
        weightKg: "",
        note: "",
      });
      setChildUpdates(await apiCall(`/sponsorship/children/${selectedChildId}/updates`));
      setMessage("Sponsored child update recorded.");
    } catch (saveError) {
      setError(saveError.message);
    }
  };

  const saveChild = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const saved = await apiCall(`/sponsorship/children/${selectedChildId}`, {
        method: "PUT",
        body: JSON.stringify({ lifecycle: status, monthlyAllowance }),
      });
      setChildren((previous) => previous.map((child) => child.id === selectedChildId
        ? { ...child, lifecycle: saved.lifecycle, monthlyAllowance: saved.monthlyAllowance }
        : child));
      setMessage("Sponsored child details updated.");
    } catch (saveError) {
      setError(saveError.message);
    }
  };

  const addGift = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      await apiCall(`/sponsorship/children/${selectedChildId}/disbursements`, {
        method: "POST",
        body: JSON.stringify(gift),
      });
      setGift({ amount: "", disbursedOn: new Date().toISOString().slice(0, 10), description: "", receiptData: "" });
      setReceiptName("");
      setDisbursements(await apiCall(`/sponsorship/children/${selectedChildId}/disbursements`));
      setMessage("Allowance/gift and receipt proof recorded.");
    } catch (saveError) {
      setError(saveError.message);
    }
  };

  const openStaffReceipt = async (id) => {
    try {
      const proof = await apiCall(`/sponsorship/disbursements/${id}/receipt`);
      setStaffProof(proof);
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  const refreshLetters = async () => {
    const fresh = await apiCall("/sponsorship/letters");
    setLetters(fresh);
  };
  const sendStaffReply = async (event) => {
    event.preventDefault();
    if (!selectedThreadId) return;
    try {
      await apiCall(`/sponsorship/letters/${selectedThreadId}/reply`, {
        method: "POST",
        body: JSON.stringify({ message: reply }),
      });
      setReply("");
      await refreshLetters();
      setMessage("Reply sent to the guardian.");
    } catch (replyError) {
      setError(replyError.message);
    }
  };
  const updateThreadStatus = async (threadId, nextStatus) => {
    try {
      await apiCall(`/sponsorship/letters/${threadId}/status`, {
        method: "PUT",
        body: JSON.stringify({ status: nextStatus }),
      });
      await refreshLetters();
    } catch (statusError) {
      setError(statusError.message);
    }
  };
  const visibleChildren = children.filter((child) =>
    (filter === "all" || child.lifecycle === filter) &&
    `${child.name} ${child.participantCode}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selectedChild = children.find((child) => child.id === selectedChildId);
  const selectedThread = letters.find((thread) => Number(thread.id) === Number(selectedThreadId));

  return (
    <>
      <Title
        e="SPONSORED CHILDREN"
        t="Sponsored care."
        d="Follow each child’s sponsorship journey, allowance, gifts, receipt proofs, and letters."
      />
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}
      <div className="sponsorship-summary-grid">
        {SPONSOR_LIFECYCLE.map((lifecycle) => (
          <button key={lifecycle} className={`sponsorship-summary-card ${filter === lifecycle ? "selected" : ""}`} onClick={() => setFilter(filter === lifecycle ? "all" : lifecycle)}>
            <span>{lifecycle}</span><strong>{children.filter((child) => child.lifecycle === lifecycle).length}</strong>
          </button>
        ))}
      </div>
      <div className="sponsorship-workspace">
        <section className="surface sponsorship-child-list">
          <div className="sponsorship-list-heading">
            <h2>Children</h2>
            <span>{visibleChildren.length}</span>
          </div>
          <input className="form-control mb-3" aria-label="Search sponsored children" placeholder="Search name or ID" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select className="form-select mb-3" aria-label="Filter by lifecycle status" value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">All lifecycle statuses</option>
            {SPONSOR_LIFECYCLE.map((lifecycle) => <option value={lifecycle} key={lifecycle}>{lifecycle}</option>)}
          </select>
          {loading ? <p role="status">Loading children...</p> : visibleChildren.map((child) => (
            <button className={`sponsorship-child-row ${Number(selectedChildId) === Number(child.id) ? "selected" : ""}`} key={child.id} onClick={() => selectChild(child)}>
              <span><strong>{child.name}</strong><small>{child.participantCode || `Child #${child.id}`}</small></span>
              <span className={`lifecycle-pill ${child.lifecycle}`}>{child.lifecycle}</span>
            </button>
          ))}
          {!loading && !visibleChildren.length && <p className="text-secondary">No children in this category.</p>}
        </section>
        <section className="surface sponsorship-child-detail">
          {!selectedChild ? (
            <div className="sponsorship-empty"><span aria-hidden="true">♡</span><h2>Select a child</h2><p>Choose a record to manage sponsorship details, allowance, and letters.</p></div>
          ) : (
            <>
              <div className="sponsorship-detail-heading">
                <div><span className="eyebrow">{selectedChild.participantCode || `CHILD #${selectedChild.id}`}</span><h2>{selectedChild.name}</h2></div>
                <span className={`lifecycle-pill ${selectedChild.lifecycle}`}>{selectedChild.lifecycle}</span>
              </div>
              <section className="sponsorship-detail-section">
                <div className="sponsorship-list-heading">
                  <div>
                    <h3>Growth and activity history</h3>
                    <span>Private notes and physical measurements are encrypted at rest.</span>
                  </div>
                  <span>{childUpdates.length} updates</span>
                </div>
                {canManage && (
                  <form className="child-update-form" onSubmit={addChildUpdate}>
                    <div className="row g-3">
                      <div className="col-12 col-md-4">
                        <label className="form-label" htmlFor="child-update-type">Update type</label>
                        <select
                          id="child-update-type"
                          className="form-select"
                          value={childUpdate.type}
                          onChange={(event) => setChildUpdate({ ...childUpdate, type: event.target.value })}
                        >
                          <option value="growth">Growth measurement</option>
                          <option value="activity">Activity attended</option>
                          <option value="note">Care note</option>
                        </select>
                      </div>
                      <div className="col-12 col-md-4">
                        <label className="form-label" htmlFor="child-update-date">Date</label>
                        <input
                          id="child-update-date"
                          className="form-control"
                          type="date"
                          max={new Date().toISOString().slice(0, 10)}
                          required
                          value={childUpdate.recordedOn}
                          onChange={(event) => setChildUpdate({ ...childUpdate, recordedOn: event.target.value })}
                        />
                      </div>
                      {childUpdate.type === "growth" && (
                        <>
                          <div className="col-12 col-md-4">
                            <label className="form-label" htmlFor="child-update-height">Height (cm)</label>
                            <input
                              id="child-update-height"
                              className="form-control"
                              type="number"
                              min="30"
                              max="260"
                              step="0.1"
                              value={childUpdate.heightCm}
                              onChange={(event) => setChildUpdate({ ...childUpdate, heightCm: event.target.value })}
                            />
                          </div>
                          <div className="col-12 col-md-4">
                            <label className="form-label" htmlFor="child-update-weight">Weight (kg)</label>
                            <input
                              id="child-update-weight"
                              className="form-control"
                              type="number"
                              min="1"
                              max="300"
                              step="0.1"
                              value={childUpdate.weightKg}
                              onChange={(event) => setChildUpdate({ ...childUpdate, weightKg: event.target.value })}
                            />
                          </div>
                        </>
                      )}
                      {childUpdate.type === "activity" && (
                        <div className="col-12 col-md-8">
                          <label className="form-label" htmlFor="child-update-activity">Activity</label>
                          <input
                            id="child-update-activity"
                            className="form-control"
                            maxLength={120}
                            required
                            value={childUpdate.activity}
                            onChange={(event) => setChildUpdate({ ...childUpdate, activity: event.target.value })}
                            placeholder="Activity or program attended"
                          />
                        </div>
                      )}
                      <div className="col-12">
                        <label className="form-label" htmlFor="child-update-note">
                          {childUpdate.type === "note" ? "Care note" : "Additional notes (optional)"}
                        </label>
                        <textarea
                          id="child-update-note"
                          className="form-control"
                          rows="2"
                          maxLength={2000}
                          required={childUpdate.type === "note"}
                          value={childUpdate.note}
                          onChange={(event) => setChildUpdate({ ...childUpdate, note: event.target.value })}
                        />
                      </div>
                      <div className="col-12">
                        <button className="btn btn-dark" type="submit">Record update</button>
                      </div>
                    </div>
                  </form>
                )}
                {childUpdates.length ? (
                  <div className="child-update-history">
                    {childUpdates.map((update) => (
                      <article className="child-update-row" key={update.id}>
                        <div>
                          <strong>{update.type === "growth" ? "Growth measurement" : update.type === "activity" ? update.activity : "Care note"}</strong>
                          <small>{new Date(`${update.recordedOn}T00:00:00`).toLocaleDateString()}</small>
                        </div>
                        {update.type === "growth" && (
                          <span>
                            {update.heightCm ? `${update.heightCm} cm` : ""}
                            {update.heightCm && update.weightKg ? " · " : ""}
                            {update.weightKg ? `${update.weightKg} kg` : ""}
                          </span>
                        )}
                        {update.note && <p>{update.note}</p>}
                      </article>
                    ))}
                  </div>
                ) : <p className="text-secondary mt-3 mb-0">No growth, activity, or care updates recorded.</p>}
              </section>
              <section className="sponsorship-detail-section">
                <h3>Sponsorship and allowance</h3>
                {canManage ? (
                  <form className="sponsorship-settings-form" onSubmit={saveChild}>
                    <div>
                      <label className="form-label" htmlFor="child-lifecycle">Child status</label>
                      <select id="child-lifecycle" className="form-select" value={status} onChange={(event) => setStatus(event.target.value)}>
                        {SPONSOR_LIFECYCLE.map((lifecycle) => <option value={lifecycle} key={lifecycle}>{lifecycle}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="form-label" htmlFor="child-allowance">Monthly allowance (PHP)</label>
                      <input id="child-allowance" className="form-control" type="number" min="0" max="1000000" step="0.01" required value={monthlyAllowance} onChange={(event) => setMonthlyAllowance(event.target.value)} />
                    </div>
                    <button className="btn btn-dark align-self-end" type="submit">Save details</button>
                  </form>
                ) : <p>Monthly allowance: <strong>{formatCurrency(selectedChild.monthlyAllowance)}</strong></p>}
                <h4 className="sponsorship-subheading">Record allowance or gift</h4>
                {canManage ? (
                  <form className="sponsorship-gift-form" onSubmit={addGift}>
                    <div><label className="form-label" htmlFor="gift-amount">Amount (PHP)</label><input id="gift-amount" className="form-control" type="number" min="0.01" max="1000000" step="0.01" required value={gift.amount} onChange={(event) => setGift({ ...gift, amount: event.target.value })} /></div>
                    <div><label className="form-label" htmlFor="gift-date">Date</label><input id="gift-date" className="form-control" type="date" required value={gift.disbursedOn} onChange={(event) => setGift({ ...gift, disbursedOn: event.target.value })} /></div>
                    <div className="sponsorship-gift-description"><label className="form-label" htmlFor="gift-description">Gift / allowance note</label><input id="gift-description" className="form-control" maxLength={255} value={gift.description} onChange={(event) => setGift({ ...gift, description: event.target.value })} placeholder="e.g. Monthly school allowance" /></div>
                    <div className="sponsorship-gift-description"><label className="form-label" htmlFor="gift-receipt">Receipt proof (JPG, PNG, PDF; max 4 MB)</label><input id="gift-receipt" className="form-control" type="file" accept="image/jpeg,image/png,application/pdf" required onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      if (file.size > 4 * 1024 * 1024) {
                        setGift((previous) => ({ ...previous, receiptData: "" }));
                        setReceiptName("");
                        setError("Receipt must be no larger than 4 MB.");
                        event.target.value = "";
                        return;
                      }
                      setGift((previous) => ({ ...previous, receiptData: "" }));
                      setReceiptName("");
                      const reader = new FileReader();
                      reader.onload = () => {
                        setGift((previous) => ({ ...previous, receiptData: String(reader.result || "") }));
                        setReceiptName(file.name);
                        setError("");
                      };
                      reader.onerror = () => setError("Unable to read the receipt file. Try a different file.");
                      reader.readAsDataURL(file);
                    }} />{receiptName && <small className="text-secondary">{receiptName}</small>}</div>
                    <button className="btn btn-outline-dark" type="submit" disabled={!gift.receiptData}>Save disbursement and proof</button>
                  </form>
                ) : <p className="text-secondary">You can view the records, but do not have permission to manage allowances.</p>}
                <div className="table-responsive mt-3">
                  <table className="table align-middle">
                    <thead><tr><th>Date</th><th>Gift / allowance</th><th>Note</th><th>Proof</th></tr></thead>
                    <tbody>{disbursements.map((record) => (
                      <tr key={record.id}><td>{new Date(record.disbursed_on).toLocaleDateString()}</td><td>{formatCurrency(record.amount)}</td><td>{record.description || "—"}</td><td>{record.hasReceipt ? <button className="btn btn-sm btn-outline-primary" onClick={() => openStaffReceipt(record.id)}>View proof</button> : "—"}</td></tr>
                    ))}{!disbursements.length && <tr><td colSpan="4" className="text-secondary">No allowance or gift records.</td></tr>}</tbody>
                  </table>
                </div>
                {staffProof && (
                  <div className="guardian-receipt-preview">
                    <div className="guardian-receipt-heading"><strong>Receipt proof</strong><button type="button" className="btn-close" aria-label="Close receipt proof" onClick={() => setStaffProof(null)} /></div>
                    {staffProof.mimeType.startsWith("image/")
                      ? <img src={`data:${staffProof.mimeType};base64,${staffProof.data}`} alt="Receipt proof" />
                      : <a href={`data:${staffProof.mimeType};base64,${staffProof.data}`} target="_blank" rel="noreferrer">Open PDF receipt proof ↗</a>}
                  </div>
                )}
              </section>
              <section className="sponsorship-detail-section">
                <div className="sponsorship-list-heading"><h3>Letters</h3><span>{letters.filter((thread) => Number(thread.participantId) === Number(selectedChild.id)).length}</span></div>
                <div className="sponsorship-letter-layout">
                  <div className="sponsorship-thread-list">
                    {letters.filter((thread) => Number(thread.participantId) === Number(selectedChild.id)).map((thread) => (
                      <button className={`sponsorship-thread-row ${Number(selectedThreadId) === Number(thread.id) ? "selected" : ""}`} key={thread.id} onClick={() => setSelectedThreadId(thread.id)}>
                        <strong>{thread.subject}</strong><span>{thread.status}</span><small>{new Date(thread.updatedAt).toLocaleDateString()}</small>
                      </button>
                    ))}
                    {!letters.some((thread) => Number(thread.participantId) === Number(selectedChild.id)) && <p className="text-secondary">No letters yet.</p>}
                  </div>
                  {selectedThread && Number(selectedThread.participantId) === Number(selectedChild.id) && (
                    <div className="sponsorship-thread-detail">
                      <div className="sponsorship-thread-title"><h4>{selectedThread.subject}</h4>
                        {canManage && <select className="form-select form-select-sm" aria-label="Update letter status" value={selectedThread.status} onChange={(event) => updateThreadStatus(selectedThread.id, event.target.value)}><option value="open">Open</option><option value="replied">Replied</option><option value="closed">Closed</option></select>}
                      </div>
                      <div className="sponsorship-messages">{selectedThread.messages.map((entry) => <div className={`sponsorship-message ${entry.sender_type}`} key={entry.id}><span>{entry.sender_type === "staff" ? "Staff" : "Guardian"} · {new Date(entry.created_at).toLocaleString()}</span><p>{entry.message}</p></div>)}</div>
                      {canManage && selectedThread.status !== "closed" && <form onSubmit={sendStaffReply}><label className="visually-hidden" htmlFor="staff-letter-reply">Reply to guardian</label><textarea id="staff-letter-reply" className="form-control mb-2" rows="3" maxLength={5000} required value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write a reply to the guardian" /><button className="btn btn-sm btn-dark">Send reply</button></form>}
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </section>
      </div>
    </>
  );
}
function PermissionCheckboxes({ idPrefix, selected, onChange }) {
  const toggle = (key, checked) => {
    onChange(checked
      ? [...new Set([...selected, key])]
      : selected.filter((permission) => permission !== key));
  };
  return (
    <div className="staff-permission-list">
      {STAFF_PERMISSION_OPTIONS.map(({ key, label, description }) => (
        <label className="staff-permission-option" htmlFor={`${idPrefix}-${key}`} key={key}>
          <input
            id={`${idPrefix}-${key}`}
            className="form-check-input"
            type="checkbox"
            checked={selected.includes(key)}
            onChange={(event) => toggle(key, event.target.checked)}
          />
          <span>
            <strong>{label}</strong>
            <small>{description}</small>
          </span>
        </label>
      ))}
    </div>
  );
}
function StaffAccounts() {
  const [staff, setStaff] = useState([]);
  const [permissionsById, setPermissionsById] = useState({});
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [newPermissions, setNewPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [permissionEditor, setPermissionEditor] = useState(null);
  const [permissionDraft, setPermissionDraft] = useState([]);

  useEffect(() => {
    if (!permissionEditor) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !saving) setPermissionEditor(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [permissionEditor, saving]);

  useEffect(() => {
    let mounted = true;
    apiCall("/staff")
      .then((result) => {
        if (!mounted) return;
        setStaff(result.staff);
        setPermissionsById(Object.fromEntries(
          result.staff.map((account) => [account.id, account.permissions]),
        ));
        setError("");
      })
      .catch((loadError) => {
        if (mounted) setError(loadError.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const createStaff = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await apiCall("/staff", {
        method: "POST",
        body: JSON.stringify({ ...form, permissions: newPermissions }),
      });
      setForm({ username: "", email: "", password: "" });
      setNewPermissions([]);
      setMessage("Church Administrator account created.");
      const result = await apiCall("/staff");
      setStaff(result.staff);
      setPermissionsById(Object.fromEntries(
        result.staff.map((account) => [account.id, account.permissions]),
      ));
    } catch (createError) {
      setError(createError.message);
    } finally {
      setSaving(false);
    }
  };

  const savePermissions = async (account, selectedPermissions) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const permissions = selectedPermissions || permissionsById[account.id] || [];
      await apiCall(`/staff/${account.id}/permissions`, {
        method: "PUT",
        body: JSON.stringify({ permissions }),
      });
      setStaff((previous) => previous.map((item) =>
        item.id === account.id ? { ...item, permissions } : item,
      ));
      setMessage(`Permissions saved for ${account.username}.`);
      setPermissionEditor(null);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const openNewPermissionEditor = () => {
    setPermissionDraft(newPermissions);
    setPermissionEditor({ type: "new" });
  };
  const openStaffPermissionEditor = (account) => {
    setPermissionDraft(permissionsById[account.id] || []);
    setPermissionEditor({ type: "staff", account });
  };

  const selectedPermissionLabels = (permissions) => STAFF_PERMISSION_OPTIONS
    .filter(({ key }) => permissions.includes(key))
    .map(({ label }) => label);

  const toggleStatus = async (account) => {
    setSaving(true);
    setError("");
    setMessage("");
    const status = account.status === "active" ? "inactive" : "active";
    try {
      await apiCall(`/staff/${account.id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      setStaff((previous) => previous.map((item) =>
        item.id === account.id ? { ...item, status } : item,
      ));
      setMessage(`${account.username} is now ${status}.`);
    } catch (statusError) {
      setError(statusError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Title
        e="STAFF ADMINISTRATION"
        t="Staff accounts."
        d="Create Church Administrator accounts and choose each account’s permissions."
      />
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}
      <section className="surface form-surface staff-create-panel">
        <h2>Register staff</h2>
        <p className="text-secondary">New accounts have the Church Administrator role. Select only the access needed for the staff member’s work.</p>
        <form className="vstack gap-3" onSubmit={createStaff}>
          <div className="row g-3">
            <div className="col-12 col-md-4">
              <label className="form-label" htmlFor="staff-username">Username</label>
              <input id="staff-username" className="form-control" maxLength={100} autoComplete="username" required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
            </div>
            <div className="col-12 col-md-4">
              <label className="form-label" htmlFor="staff-email">Email</label>
              <input id="staff-email" className="form-control" type="email" maxLength={150} autoComplete="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </div>
            <div className="col-12 col-md-4">
              <label className="form-label" htmlFor="staff-password">Temporary password</label>
              <input id="staff-password" className="form-control" type="password" minLength={8} maxLength={72} autoComplete="new-password" required value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
              <small className="text-secondary">At least 8 characters; give it to the staff member securely.</small>
            </div>
          </div>
          <div className="staff-create-permissions">
            <div>
              <strong>Account access</strong>
              <small>{newPermissions.length} permission{newPermissions.length === 1 ? "" : "s"} selected</small>
            </div>
            <button className="btn btn-outline-primary" type="button" onClick={openNewPermissionEditor}>
              Choose permissions
            </button>
          </div>
          <button className="btn btn-dark align-self-start" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Create staff account"}
          </button>
        </form>
      </section>
      <section className="surface table-surface staff-list-panel">
        <div className="panel-title"><h2>Staff accounts</h2><span>{staff.length} accounts</span></div>
        {loading ? <p role="status">Loading staff accounts...</p> : staff.length ? (
          <div className="staff-account-list">
            {staff.map((account) => (
              <article className="staff-account-card" key={account.id}>
                <div className="staff-account-heading">
                  <div>
                    <h3>{account.username}</h3>
                    <p>{account.email} · {account.role}</p>
                  </div>
                  <span className={`staff-account-status ${account.status}`}>{account.status}</span>
                </div>
                <div className="staff-account-permissions">
                  <div>
                    <strong>{(permissionsById[account.id] || []).length} permissions assigned</strong>
                    <span>{selectedPermissionLabels(permissionsById[account.id] || []).join(" · ") || "No page access assigned"}</span>
                  </div>
                  <button
                    className="btn btn-outline-primary btn-sm"
                    type="button"
                    onClick={() => openStaffPermissionEditor(account)}
                  >
                    Edit permissions
                  </button>
                </div>
                <div className="staff-account-actions">
                  <button className={`btn btn-sm ${account.status === "active" ? "btn-outline-danger" : "btn-outline-success"}`} disabled={saving} onClick={() => toggleStatus(account)}>
                    {account.status === "active" ? "Deactivate account" : "Activate account"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : <p className="text-secondary">No Church Administrator accounts are registered.</p>}
      </section>
      {permissionEditor && createPortal(
        <div
          className="staff-permission-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setPermissionEditor(null);
          }}
        >
          <section
            className="staff-permission-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-permission-modal-title"
          >
            <header className="staff-permission-modal-header">
              <div>
                <span className="eyebrow">STAFF ACCESS</span>
                <h2 id="staff-permission-modal-title">
                  {permissionEditor.type === "new"
                    ? "Choose staff permissions"
                    : `Permissions for ${permissionEditor.account.username}`}
                </h2>
                <p>Select the pages and actions this Church Administrator can access.</p>
              </div>
              <button
                type="button"
                className="btn-close"
                aria-label="Close permission editor"
                disabled={saving}
                onClick={() => setPermissionEditor(null)}
              />
            </header>
            <PermissionCheckboxes
              idPrefix={permissionEditor.type === "new" ? "new-staff-modal" : `staff-${permissionEditor.account.id}-modal`}
              selected={permissionDraft}
              onChange={setPermissionDraft}
            />
            <footer className="staff-permission-modal-footer">
              <button
                type="button"
                className="btn btn-outline-secondary"
                disabled={saving}
                onClick={() => setPermissionEditor(null)}
              >
                Cancel
              </button>
              {permissionEditor.type === "staff" ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving}
                  onClick={() => savePermissions(permissionEditor.account, permissionDraft)}
                >
                  {saving ? "Saving…" : "Save permissions"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setNewPermissions(permissionDraft);
                    setPermissionEditor(null);
                  }}
                >
                  Apply permissions
                </button>
              )}
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
function storedUser() {
  const user = JSON.parse(localStorage.user || "null");
  if (String(user?.role).toLowerCase() === "admin") {
    user.role = "System Administrator";
    localStorage.user = JSON.stringify(user);
  }
  if (
    ["program coordinator", "check-in volunteer"].includes(
      String(user?.role).toLowerCase(),
    )
  ) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    return null;
  }
  return user;
}
function App() {
  const [user, setUser] = useState(storedUser);
  const [authTransition, setAuthTransition] = useState("");
  const [page, setPage] = useState("dashboard");
  const [pageChanging, setPageChanging] = useState(false);
  const [pageTransitionId, setPageTransitionId] = useState(0);
  const pageTransitionTimer = useRef(null);
  const authTransitionTimer = useRef(null);
  useEffect(() => {
    const expire = () => setUser(null);
    window.addEventListener("auth-expired", expire);
    return () => window.removeEventListener("auth-expired", expire);
  }, []);
  useEffect(() => () => {
    clearTimeout(pageTransitionTimer.current);
    clearTimeout(authTransitionTimer.current);
  }, []);
  const completeLogin = (authenticatedUser) => {
    clearTimeout(authTransitionTimer.current);
    setUser(authenticatedUser);
    setAuthTransition("Loading your workspace…");
    authTransitionTimer.current = setTimeout(() => setAuthTransition(""), 700);
  };
  const navigateToPage = (nextPage) => {
    if (nextPage === page) return;
    clearTimeout(pageTransitionTimer.current);
    setPage(nextPage);
    setPageChanging(true);
    setPageTransitionId((current) => current + 1);
    pageTransitionTimer.current = setTimeout(() => setPageChanging(false), 450);
  };
  if (!user) {
    return (
      <>
        <PublicHome onLogin={completeLogin} />
        {authTransition && <LoadingScreen message={authTransition} />}
      </>
    );
  }
  let pages = {
    dashboard: <Dashboard go={navigateToPage} />,
    participants: <Participants canManage={canAccessPermission("participants:manage", user)} user={user} />,
    events: <Events canManage={canAccessPermission("events:manage", user)} />,
    scanner: <Scanner />,
    portal: <Scanner portal />,
    sponsorship: <SponsoredCare user={user} />,
    analytics: <Analytics />,
    reports: <Reports user={user} />,
  };
  if (STAFF_ROLES.includes(String(user.role).toLowerCase())) {
    pages.account = <AccountSettings onUserUpdated={setUser} />;
  }
  if (String(user.role).toLowerCase() === "system administrator") {
    pages.audit = <AuditHistory />;
    pages.staff = <StaffAccounts />;
  }
  const availablePages = Object.keys(pages).filter((key) => canAccessPage(key, user));
  const visiblePage = canAccessPage(page, user) ? page : availablePages[0];
  return (
    <div className="app-shell">
      <Header
        user={user}
        page={visiblePage}
        go={navigateToPage}
        logout={() => {
          clearTimeout(authTransitionTimer.current);
          setAuthTransition("Signing out…");
          localStorage.clear();
          setUser(null);
          authTransitionTimer.current = setTimeout(() => setAuthTransition(""), 500);
        }}
      />
      <main className="content">
        {pageChanging && (
          <div
            key={pageTransitionId}
            className="page-transition-indicator"
            role="status"
            aria-label="Loading page"
          >
            <span />
          </div>
        )}
        <div key={visiblePage} className="page-view-enter">
          {visiblePage ? (
            pages[visiblePage]
          ) : (
            <div className="alert alert-warning" role="alert">
              Your account does not have access to any pages. Contact an administrator.
            </div>
          )}
        </div>
      </main>
      {authTransition && <LoadingScreen message={authTransition} />}
    </div>
  );
}
export default App;
