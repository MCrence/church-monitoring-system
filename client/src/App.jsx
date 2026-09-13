import { useEffect, useRef, useState } from "react";
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
function Login({ done }) {
  const [f, setF] = useState({ username: "", password: "" });
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
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
    }
  };
  return (
    <main className="login-page">
      <div className="login-panel">
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
            required
          />
          <input
            className="form-control form-control-lg"
            type="password"
            placeholder="Password"
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
            required
          />
          <button className="btn btn-dark btn-lg">Sign in →</button>
          {err && <div className="alert alert-danger">{err}</div>}
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
  );
}
function Header({ user, page, go, logout }) {
  let links = [
    ["dashboard", "Overview"],
    ["participants", "Participants"],
    ["register", "Register"],
    ["events", "Events"],
    ["scanner", "Check-in"],
    ["analytics", "Analytics"],
    ["reports", "Reports"],
    ["portal", "Child portal"],
  ];
  return (
    <header className="topbar">
      <button className="brand-button" onClick={() => go("dashboard")}>
        <img src="/church-logo.png" alt="" />
        <span>FMC FIELD CARE</span>
      </button>
      <nav className="nav-pills">
        {links.map(([k, l]) => (
          <button
            key={k}
            className={page === k ? "active" : ""}
            onClick={() => go(k)}
          >
            {l}
          </button>
        ))}
      </nav>
      <div className="user-menu">
        <span className="avatar">{user.username?.[0]?.toUpperCase()}</span>
        <span className="d-none d-md-inline">{user.role}</span>
        <button className="btn btn-sm btn-outline-secondary" onClick={logout}>
          Sign out
        </button>
      </div>
    </header>
  );
}
const Field = ({ label, ...p }) => (
  <div className="col-12 col-md-6">
    <label className="form-label">{label}</label>
    <input className="form-control" {...p} />
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
  useEffect(() => {
    apiCall("/dashboard")
      .then(setD)
      .catch(() => {});
  }, []);
  return (
    <>
      <Title
        e="COMMAND CENTER"
        t="Good morning."
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
          ["Needs attention", d.atRisk.length, "Medium and high risk"],
        ].map((x) => (
          <div className="col-12 col-sm-6 col-lg-3" key={x[0]}>
            <div className="stat-card">
              <small>{x[0]}</small>
              <strong>{x[1]}</strong>
              <span>{x[2]}</span>
            </div>
          </div>
        ))}
        <div className="col-12 col-lg-3">
          <button
            className="action-tile h-100 w-100"
            onClick={() => go("register")}
          >
            <span className="tile-icon">＋</span>
            <strong>Register participant</strong>
            <small>Issue a new digital ID</small>
          </button>
        </div>
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
          <h2>At risk</h2>
          <div className="risk-list">
            {d.atRisk.map((r) => (
              <div className="risk-row" key={`${r.id}-${r.computed_at}`}>
                <div>
                  <strong>
                    {r.participant_code || `Participant #${r.id}`}
                  </strong>
                  <small>{r.computed_at}</small>
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
function Register() {
  const blank = {
    fullName: "",
    dateOfBirth: "",
    gender: "",
    phone: "",
    address: "",
    participantType: "goer",
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
    passcode: "",
  };
  const [f, setF] = useState(blank);
  const [result, setR] = useState(null);
  const update = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    try {
      setR(
        await apiCall("/participants", {
          method: "POST",
          body: JSON.stringify(f),
        }),
      );
      setF(blank);
    } catch (x) {
      alert(x.message);
    }
  };
  return (
    <>
      <Title
        e="PARTICIPANTS / NEW RECORD"
        t="Register a participant."
        d="Create an encrypted profile and issue a secure digital ID."
      />
      <div className="row g-4">
        <form className="col-12 col-lg-7" onSubmit={submit}>
          <div className="surface form-surface">
            <div className="row g-3">
              <Field
                label="Full name"
                value={f.fullName}
                onChange={update("fullName")}
                required
              />
              <Field
                label="Date of birth"
                type="date"
                value={f.dateOfBirth}
                onChange={update("dateOfBirth")}
              />
              <TypeChoice
                value={f.participantType}
                onChange={(value) => setF({ ...f, participantType: value })}
              />
              <Field
                label="Gender"
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
                  <Field
                    label="Portal passcode"
                    type="password"
                    value={f.passcode}
                    onChange={update("passcode")}
                    required
                  />
                </>
              )}
            </div>
            <button className="btn btn-dark mt-4">
              Create profile and QR →
            </button>
          </div>
        </form>
        <div className="col-12 col-lg-5">
          {result ? (
            <div className="qr-result surface">
              <span className="eyebrow">DIGITAL ID READY</span>
              <h2>{result.participantCode}</h2>
              <img
                src={result.qrCodeImage}
                alt="Generated participant QR code"
              />
              <button
                className="btn btn-outline-dark"
                onClick={() => window.print()}
              >
                Print card
              </button>
            </div>
          ) : (
            <div className="empty-art surface">
              <span className="tile-icon">⌁</span>
              <h2>
                One profile.
                <br />
                One secure ID.
              </h2>
              <p>The generated QR code can be printed for a physical card.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
function Participants() {
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const update = (key) => (event) =>
    setForm({ ...form, [key]: event.target.value });
  useEffect(() => {
    apiCall("/participants")
      .then((data) => setList(Array.isArray(data) ? data.filter(p => p.status !== 'deleted') : []))
      .catch((error) => setMessage(error.message));
  }, []);
  const choose = async (id) => {
    try {
      const data = await apiCall(`/participants/${id}`);
      setSelected(id);
      setForm({
        ...data.participant,
        participantType: data.participant.participant_type,
        passcode: '',
      });
      setEditing(false);
      setMessage("");
    } catch (error) {
      setMessage(error.message);
    }
  };
  const save = async (event) => {
    event.preventDefault();
    try {
      const data = await apiCall(`/participants/${selected}`, {
        method: "PUT",
        body: JSON.stringify(form),
      });
      setForm({
        ...data.participant,
        participantType: data.participant.participant_type,
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
                <div>
                  <button type="button" className="btn btn-outline-dark me-2" onClick={() => setEditing(true)}>Edit details</button>
                  <button type="button" className="btn btn-danger" onClick={deleteParticipant}>Delete</button>
                </div>
              </div>
              {form.qr_code_image ? <img className="participant-qr-image" src={`/${form.qr_code_image}`} alt={`QR code for ${form.participant_code}`} /> : <p className="text-secondary">No active QR code found.</p>}
              {form.qr_code_image && <button type="button" className="btn btn-dark" onClick={() => window.print()}>Print QR card</button>}
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
                <Field
                  label="Full name"
                  value={form.fullName || ""}
                  onChange={update("fullName")}
                  required
                />
                <Field
                  label="Date of birth"
                  type="date"
                  value={(form.dateOfBirth || "").slice(0, 10)}
                  onChange={update("dateOfBirth")}
                />
                <TypeChoice
                  value={form.participantType}
                  onChange={(value) =>
                    setForm({ ...form, participantType: value })
                  }
                />
                <Field
                  label="Gender"
                  value={form.gender || ""}
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
                      label="Portal passcode"
                      type="password"
                      value={form.passcode || ""}
                      onChange={update("passcode")}
                      placeholder="Leave blank to keep existing"
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
    </>
  );
}
function Camera({ id, onScan }) {
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
          setError(
            "Camera unavailable. Grant permission or paste the QR payload below.",
          );
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
  }, [id]);
  return (
    <>
      <div id={id} className="qr-reader" />
      {error && <div className="alert alert-warning mt-3">{error}</div>}
    </>
  );
}
function Scanner({ portal = false }) {
  const [payload, setPayload] = useState("");
  const [toast, setToast] = useState(null);
  const [pass, setPass] = useState("");
  const [requiresPasscode, setRequiresPasscode] = useState(false);
  const [profile, setProfile] = useState(null);
  const [event, setEvent] = useState("Sunday service");
  const [location, setLocation] = useState("Main hall");
  const [events, setEvents] = useState([]);
  const portalBusy = useRef(false);
  const checkinBusy = useRef(false);

  useEffect(() => {
    if (!portal) apiCall("/events").then(setEvents).catch(() => {});
  }, [portal]);

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

    // Station mode: automatically record attendance on scan
    if (checkinBusy.current) return;
    checkinBusy.current = true;
    try {
      const headers = { "Content-Type": "application/json", ...(localStorage.token ? { Authorization: `Bearer ${localStorage.token}` } : {}) };
      const resp = await fetch(api + "/checkin", { method: "POST", headers, body: JSON.stringify({ qrPayload: v, eventName: event, location }) });
      const result = await resp.json().catch(() => ({}));
      if (resp.status === 401) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        window.dispatchEvent(new Event("auth-expired"));
      }
      if (resp.ok) {
        if (result && result.status === 'duplicate') showToast('Already checked-in today for this event.', 'warning');
        else showToast("Attendance recorded.", "success");
      } else {
        // treat non-ok as failure to send (will fall through to queueing)
        throw new Error(result.error || 'Request failed');
      }
    } catch (x) {
      // If offline or server unreachable, queue and inform user (avoid duplicates)
      try {
        const queued = await queueCheckin({ qrPayload: v, eventName: event, location });
        if (queued) showToast("Offline: attendance queued for sync.", "info");
        else showToast("Attendance already queued for today.", "warning");
      } catch (qerr) {
        showToast(x.message || "Failed to record attendance.", "danger");
      }
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
        const headers = { "Content-Type": "application/json", ...(localStorage.token ? { Authorization: `Bearer ${localStorage.token}` } : {}) };
        const resp = await fetch(api + "/checkin", { method: "POST", headers, body: JSON.stringify({ qrPayload: payload, eventName: event, location }) });
        const result = await resp.json().catch(() => ({}));
        if (resp.status === 401) {
          localStorage.removeItem("token");
          localStorage.removeItem("user");
          window.dispatchEvent(new Event("auth-expired"));
        }
        if (resp.ok) {
          if (result && result.status === 'duplicate') showToast('Already checked-in today for this event.', 'warning');
          else showToast("Check-in recorded successfully.", "success");
        } else {
          throw new Error(result.error || 'Request failed');
        }
      }
    } catch (x) {
      if (!portal) {
        try {
          const queued = await queueCheckin({ qrPayload: payload, eventName: event, location });
          if (queued) showToast("Offline: check-in queued for sync.", "info");
          else showToast("Attendance already queued for today.", "warning");
        } catch (qerr) {
          showToast(x.message || "Offline: failed to queue check-in.", "danger");
        }
      } else {
        setRequiresPasscode(x.message === "Sponsored Child passcode required");
        showToast(x.message, x.message === "Sponsored Child passcode required" ? "warning" : "danger");
      }
    }
  };
  useEffect(() => {
    if (!portal) {
      let sync = () =>
        syncQueuedCheckins((x) =>
          apiCall("/checkin", { method: "POST", body: JSON.stringify(x) }),
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
              <div><small>Enrollment date</small><strong>{profile.enrollmentDate || "Not provided"}</strong></div>
              <div><small>Program affiliation</small><strong>{profile.programAffiliation || "Not provided"}</strong></div>
            </div>
          </div>}
          <h3 className="mt-4">Recent attendance</h3>
          <div className="table-responsive"><table className="table"><tbody>{(profile.attendance || []).map((row, index) => <tr key={index}><td>{row.event_name}</td><td>{row.checked_in_at ? new Date(row.checked_in_at).toLocaleString() : "—"}</td><td>{row.status}</td></tr>)}</tbody></table></div>
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
                  <select className="form-select" value={event} onChange={(e) => {
                    const selectedEvent = events.find((item) => item.name === e.target.value);
                    setEvent(e.target.value);
                    if (selectedEvent?.location) setLocation(selectedEvent.location);
                  }}>
                    <option value="Sunday service">Sunday service (custom)</option>
                    {events.map((item) => <option key={item.id} value={item.name}>{item.name} · {new Date(item.starts_at).toLocaleString()}</option>)}
                  </select>
                </div>
                <Field
                  label="Location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </>
            )}
            <button
              className="btn btn-dark mt-3 w-100"
              disabled={!payload}
              onClick={send}
            >
              {portal ? "Verify and open profile" : "Record check-in"} →
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
function Events() {
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ name: "", description: "", startsAt: "", endsAt: "", location: "" });
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  const load = () => apiCall("/events").then(setEvents).catch((error) => setMessage(error.message));
  useEffect(() => {
    load();
  }, []);
  const create = async (event) => {
    event.preventDefault();
    try {
      await apiCall("/events", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", description: "", startsAt: "", endsAt: "", location: "" });
      setMessage("Event schedule created.");
      load();
    } catch (error) { setMessage(error.message); }
  };
  const viewAttendance = async (id) => {
    try {
      const data = await apiCall(`/events/${id}/attendance`);
      setSelected(data.event);
      setAttendance(data.attendance);
    } catch (error) { setMessage(error.message); }
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
      <div className="col-12 col-lg-5">
        <form className="surface form-surface" onSubmit={create}>
          <h2 className="mb-3">Create event</h2>
          <Field label="Event name" value={form.name} onChange={update("name")} required />
          <Field label="Location" value={form.location} onChange={update("location")} />
          <Field label="Starts" type="datetime-local" value={form.startsAt} onChange={update("startsAt")} required />
          <Field label="Ends" type="datetime-local" value={form.endsAt} onChange={update("endsAt")} />
          <div className="mb-3"><label className="form-label">Description</label><textarea className="form-control" rows="3" value={form.description} onChange={update("description")} /></div>
          <button className="btn btn-dark">Save event schedule →</button>
          {message && <div className="alert alert-info mt-3 mb-0">{message}</div>}
        </form>
      </div>
      <div className="col-12 col-lg-7">
        <div className="surface table-surface"><h2 className="pt-3">Upcoming events</h2>{upcoming.length ? upcoming.map((item) => <EventRow item={item} key={item.id} />) : <p className="text-secondary py-3">No upcoming events.</p>}</div>
        <div className="surface table-surface mt-4"><h2 className="pt-3">Past events</h2>{past.length ? past.map((item) => <EventRow item={item} key={item.id} />) : <p className="text-secondary py-3">No past events.</p>}</div>
      </div>
    </div>
    {selected && <div className="surface table-surface mt-4"><div className="panel-title"><h2>{selected.name} attendance</h2><span>{attendance.length} checked in</span></div><div className="table-responsive"><table className="table"><thead><tr><th>Participant</th><th>Type</th><th>Location</th><th>Checked in</th></tr></thead><tbody>{attendance.map((row) => <tr key={row.id}><td>{row.participant_code || `Participant #${row.participant_id}`}</td><td>{row.participant_type}</td><td>{row.location || "—"}</td><td>{new Date(row.checked_in_at).toLocaleString()}</td></tr>)}</tbody></table></div></div>}
  </>;
}
function Analytics() {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState("all");
  const canvas = useRef(null);
  useEffect(() => {
    apiCall("/risk-scores")
      .then(setRows)
      .catch(() => {});
  }, []);
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
        e="PREDICTIVE ANALYTICS"
        t="See the next need."
        d="Risk scores combine recency and participation patterns."
      />
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
            <h2>Risk register</h2>
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
function Reports() {
  const [range, setRange] = useState("weekly");
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
  return (
    <>
      <Title
        e="REPORTING"
        t="Turn activity into clarity."
        d="Export attendance records for your weekly or monthly review."
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
    </>
  );
}
function App() {
  const [user, setUser] = useState(() =>
    JSON.parse(localStorage.user || "null"),
  );
  const [page, setPage] = useState("dashboard");
  useEffect(() => {
    const expire = () => setUser(null);
    window.addEventListener("auth-expired", expire);
    return () => window.removeEventListener("auth-expired", expire);
  }, []);
  if (!user) return <Login done={setUser} />;
  let pages = {
    dashboard: <Dashboard go={setPage} />,
    participants: <Participants />,
    register: <Register />,
    events: <Events />,
    scanner: <Scanner />,
    portal: <Scanner portal />,
    analytics: <Analytics />,
    reports: <Reports />,
  };
  return (
    <div className="app-shell">
      <Header
        user={user}
        page={page}
        go={setPage}
        logout={() => {
          localStorage.clear();
          setUser(null);
        }}
      />
      <main className="content">{pages[page]}</main>
    </div>
  );
}
export default App;
