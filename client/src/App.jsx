import { useCallback, useEffect, useId, useRef, useState } from "react";
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
  if (!r.ok) {
    const error = new Error(d.error || "Request failed");
    error.errors = d.errors || {};
    error.code = d.code || "";
    error.duplicates = Array.isArray(d.duplicates) ? d.duplicates : [];
    throw error;
  }
  return d;
};
const api = "/api";
const formatCount = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString() : "0";
};
const STAFF_ROLES = ["system administrator", "church administrator"];
const GOER_ROLE = "goer";
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
  { key: "sponsorship:view", label: "View sponsored care", description: "View allowance balance transactions, disbursements, and letter threads." },
  { key: "sponsorship:manage", label: "Manage sponsored care", description: "Add or deduct allowance balances, record disbursements, record care updates, and reply to letters." },
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
  account: [...STAFF_ROLES, GOER_ROLE],
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
  ["staff", "Manage Accounts"],
  ["audit", "Audit history"],
];
const canAccessPermission = (permission, user) => {
  const role = String(user?.role || user || "").toLowerCase();
  if (role === "system administrator") return true;
  if (role === GOER_ROLE) {
    return permission === "checkin:record" ||
      (permission === "sponsorship:view" &&
        user?.permissions?.includes("goer-care:view"));
  }
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
const SPONSOR_LIFECYCLE = [
  { value: "active", label: "Active", description: "Sponsorship is active." },
  { value: "on_hold", label: "On Hold", description: "Sponsorship is temporarily paused." },
  { value: "withdrawn", label: "Withdrawn", description: "The child or guardian voluntarily left the program." },
  { value: "deceased", label: "Deceased", description: "The child passed away." },
  { value: "completed", label: "Sponsorship Completed", description: "The child has officially completed the sponsorship program." },
];
const normalizeSponsorLifecycle = (value) => {
  if (value === "graduated") return "completed";
  if (value === "new" || !value) return "active";
  return value;
};
const sponsorLifecycleLabel = (value) =>
  SPONSOR_LIFECYCLE.find((status) => status.value === normalizeSponsorLifecycle(value))?.label || "Active";
const EDUCATION_LEVELS = [
  "Elementary",
  "Junior High School",
  "Senior High School",
  "College",
];
const GENDER_OPTIONS = ["Male", "Female"];
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
function calculateParticipantAge(dateOfBirth, today = new Date()) {
  const date = String(dateOfBirth || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const birth = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime()) || birth.toISOString().slice(0, 10) !== date) return "";
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  if (
    today.getUTCMonth() < birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate())
  ) age -= 1;
  return age < 0 ? "" : age;
}
function useParticipantAge(dateOfBirth) {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const now = new Date();
    const nextUtcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const timer = window.setTimeout(() => setToday(new Date()), nextUtcDay - now.getTime());
    return () => window.clearTimeout(timer);
  }, [today]);
  return calculateParticipantAge(dateOfBirth, today);
}
function normalizePhilippineMobile(value) {
  const phone = String(value || "").trim().replace(/[\s()-]/g, "");
  return /^09\d{9}$/.test(phone) || /^639\d{9}$/.test(phone) || /^\+639\d{9}$/.test(phone);
}
function validateParticipantRegistration(form) {
  const errors = {};
  if (!form.firstName.trim()) errors.firstName = "First name is required.";
  else if (form.firstName.trim().length > 100) errors.firstName = "Use 100 characters or fewer.";
  if (!form.lastName.trim()) errors.lastName = "Last name is required.";
  else if (form.lastName.trim().length > 100) errors.lastName = "Use 100 characters or fewer.";
  if (form.middleName.trim().length > 100) errors.middleName = "Use 100 characters or fewer.";
  if (!form.dateOfBirth) errors.dateOfBirth = "Date of birth is required.";
  else if (calculateParticipantAge(form.dateOfBirth) === "") errors.dateOfBirth = "Enter a valid date of birth.";
  else if (calculateParticipantAge(form.dateOfBirth) < 6 || calculateParticipantAge(form.dateOfBirth) > 22) {
    errors.dateOfBirth = "Sponsored children must be between 6 and 22 years old.";
  }
  if (!GENDER_OPTIONS.includes(form.gender)) errors.gender = "Select Male or Female.";
  if (!EDUCATION_LEVELS.includes(form.educationLevel)) errors.educationLevel = "Select an education level.";
  else if (!GRADE_LEVELS[form.educationLevel]?.includes(form.gradeLevel)) {
    errors.gradeLevel = "Select a valid grade or year level.";
  }
  if (form.educationLevel === "College" && !form.programCourse.trim()) {
    errors.programCourse = "Enter the college program or course.";
  } else if (form.programCourse.trim().length > 200) {
    errors.programCourse = "Use 200 characters or fewer.";
  }
  if (!form.emergencyContactName.trim()) errors.emergencyContactName = "Guardian/emergency contact name is required.";
  else if (form.emergencyContactName.trim().length > 100) errors.emergencyContactName = "Use 100 characters or fewer.";
  if (!normalizePhilippineMobile(form.emergencyContactPhone)) {
    errors.emergencyContactPhone = "Enter a valid Philippine mobile number.";
  }
  if (form.schoolName.trim().length > 200) errors.schoolName = "Use 200 characters or fewer.";
  if (form.schoolAddress.trim().length > 500) errors.schoolAddress = "Use 500 characters or fewer.";
  return errors;
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
  const [f, setF] = useState({ email: "", password: "" });
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
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
              type="email"
              placeholder="Email address"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
              autoComplete="email"
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
  const canManageAccount = STAFF_ROLES.includes(String(user.role).toLowerCase()) ||
    String(user.role).toLowerCase() === GOER_ROLE;
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
        <span className="avatar">{(user.fullName || user.email || "?")[0]?.toUpperCase()}</span>
        {canManageAccount ? (
          <button
            className="account-trigger d-none d-md-inline"
            type="button"
            aria-label="Open account settings"
            onClick={() => go("account")}
          >
            {user.fullName || user.email}
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
  const [name, setName] = useState({ firstName: "", middleName: "", lastName: "" });
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
        setName({
          firstName: profile.firstName || "",
          middleName: profile.middleName || "",
          lastName: profile.lastName || "",
        });
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
        body: JSON.stringify({ ...name, currentPassword, newPassword }),
      });
      localStorage.token = result.token;
      localStorage.user = JSON.stringify(result.user);
      onUserUpdated(result.user);
      setAccount(result.user);
      setName({
        firstName: result.user.firstName || "",
        middleName: result.user.middleName || "",
        lastName: result.user.lastName || "",
      });
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
        e={String(account?.role || "").toLowerCase() === GOER_ROLE ? "GOER ACCOUNT" : "ADMIN ACCOUNT"}
        t="Manage your account."
        d="Update your name, password, and verified email address."
      />
      {loading ? (
        <p role="status">Loading account details...</p>
      ) : (
        <div className="row g-4">
          <section className="col-12 col-lg-6">
            <div className="surface form-surface account-panel">
              <h2>Name and password</h2>
              <form className="vstack gap-3" onSubmit={updateCredentials}>
                <div className="row g-3">
                  <div className="col-12 col-md-4">
                    <label className="form-label" htmlFor="account-first-name">First name</label>
                    <input id="account-first-name" className="form-control" autoComplete="given-name" maxLength={100} required value={name.firstName} onChange={(event) => setName({ ...name, firstName: event.target.value })} />
                  </div>
                  <div className="col-12 col-md-4">
                    <label className="form-label" htmlFor="account-middle-name">Middle name</label>
                    <input id="account-middle-name" className="form-control" autoComplete="additional-name" maxLength={100} value={name.middleName} onChange={(event) => setName({ ...name, middleName: event.target.value })} />
                  </div>
                  <div className="col-12 col-md-4">
                    <label className="form-label" htmlFor="account-last-name">Last name</label>
                    <input id="account-last-name" className="form-control" autoComplete="family-name" maxLength={100} required value={name.lastName} onChange={(event) => setName({ ...name, lastName: event.target.value })} />
                  </div>
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
                  <small className="text-secondary">Leave blank if you are only updating your name.</small>
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
const Field = ({ label, error, ...p }) => {
  const generatedId = useId();
  const id = p.id || generatedId;
  return (
    <div className="col-12 col-md-6">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <input
        {...p}
        id={id}
        className={`form-control${error ? " is-invalid" : ""}${p.className ? ` ${p.className}` : ""}`}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={[
          p["aria-describedby"],
          error ? `${id}-error` : "",
        ].filter(Boolean).join(" ") || undefined}
      />
      {error && <div className="invalid-feedback" id={`${id}-error`}>{error}</div>}
    </div>
  );
};
function AgeValue({ dateOfBirth }) {
  const age = useParticipantAge(dateOfBirth);
  return age === "" ? "Not available" : `${age} years`;
}
function AgeField({ dateOfBirth }) {
  const age = useParticipantAge(dateOfBirth);
  return (
    <Field
      label="Age (calculated)"
      value={age === "" ? "" : `${age} years`}
      readOnly
      aria-readonly="true"
    />
  );
}
const GenderSelect = ({ id, value, onChange, required = false, error }) => (
  <div className="col-12 col-md-6">
    <label className="form-label" htmlFor={id}>
      Sex
    </label>
    <select
      id={id}
      className={`form-select${error ? " is-invalid" : ""}`}
      value={GENDER_OPTIONS.includes(value) ? value : ""}
      onChange={onChange}
      required={required}
      aria-invalid={error ? "true" : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <option value="">Select sex</option>
      {GENDER_OPTIONS.map((option) => <option key={option}>{option}</option>)}
    </select>
    {error && <div className="invalid-feedback" id={`${id}-error`}>{error}</div>}
  </div>
);
function Dashboard({ go }) {
  const [d, setD] = useState({ counts: {}, recentCheckins: [], atRisk: [] });
  const [greeting, setGreeting] = useState(() => getGreeting());
  const [dashboardError, setDashboardError] = useState("");
  useEffect(() => {
    apiCall(`/dashboard`)
      .then(setD)
      .catch((error) => setDashboardError(error.message));
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
      {dashboardError && <div className="alert alert-danger" role="alert">{dashboardError}</div>}
      <div className="row g-3 mb-4">
        {[
          [
            "Total active participant",
            d.counts.activeParticipants ?? "—",
            `${d.counts.participants ?? "—"} total records`,
          ],
          ["Total Goer", d.counts.totalGoers ?? "—", "Goer participants"],
          ["Total staff", d.counts.totalStaff ?? "—", "Active staff accounts"],
          ["Total Events", d.counts.totalEvents ?? "—", "Events on record"],
        ].map((x) => (
          <div className="col-12 col-sm-6 col-lg-3" key={x[0]}>
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
    address: "",
    participantType: "sponsored_child",
    educationLevel: "",
    gradeLevel: "",
    programCourse: "",
    schoolName: "",
    schoolAddress: "",
    weight: "",
    height: "",
    medicalConditions: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
  };
  const [f, setF] = useState(blank);
  const [result, setR] = useState(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [duplicates, setDuplicates] = useState([]);
  const [confirmPotentialDuplicate, setConfirmPotentialDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);
  const setFieldValue = (key, value) => {
    setF((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
    setError("");
    setDuplicates([]);
    setConfirmPotentialDuplicate(false);
  };
  const update = (key) => (event) => setFieldValue(key, event.target.value);
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const validationErrors = validateParticipantRegistration(f);
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length) {
      setError("Please correct the highlighted fields before registering.");
      return;
    }
    setSaving(true);
    try {
      const created = await apiCall("/participants", {
        method: "POST",
        body: JSON.stringify({
          ...f,
          fullName: composeFullName(f),
          confirmPotentialDuplicate,
        }),
      });
      setR({ ...created, dateOfBirth: f.dateOfBirth });
      setF(blank);
      await onCreated();
    } catch (x) {
      setError(x.message);
      setFieldErrors(x.errors || {});
      setDuplicates(x.duplicates || []);
      setConfirmPotentialDuplicate(false);
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
            <h2 id="register-participant-title">{result ? "Sponsored child registered." : "Register a sponsored child."}</h2>
            <p>Create an encrypted participant profile and issue a secure digital ID.</p>
          </div>
          <button type="button" className="btn-close" aria-label="Close registration" onClick={onClose} />
        </header>
        {result ? (
          <div className="participant-registration-success">
            <span className="eyebrow">DIGITAL ID READY</span>
            <h3>{result.participantCode}</h3>
            <p className="participant-registration-age">Age: <AgeValue dateOfBirth={result.dateOfBirth} /></p>
            <img src={result.qrCodeImage} alt="Generated participant QR code" />
            {result.passcode && (
              <div className="participant-generated-passcode" role="status">
                <span className="eyebrow">GUARDIAN PORTAL PASSCODE</span>
                <strong>{result.passcode}</strong>
                <p>Share this passcode securely with the child’s guardian. It is shown only during registration.</p>
              </div>
            )}
            <div className={`alert ${result.notification?.status === "accepted" || result.notification?.status === "sent" ? "alert-success" : result.notification?.status === "not_configured" ? "alert-warning" : "alert-danger"}`} role="status">
              {result.notification?.status === "accepted" && "Semaphore accepted the guardian SMS for processing; this does not confirm receipt."}
              {result.notification?.status === "sent" && "Semaphore reports the SMS sent to the carrier network; this does not confirm receipt by the guardian."}
              {result.notification?.status === "not_configured" && "The participant was registered, but SMS is not configured. Add the Semaphore credentials to the server environment."}
              {result.notification?.status === "failed" && "The participant was registered, but Semaphore did not confirm the SMS. Contact the guardian directly."}
            </div>
            <div className="d-flex flex-wrap justify-content-center gap-2">
              <button type="button" className="btn btn-outline-dark" onClick={() => window.print()}>Print card</button>
              <button type="button" className="btn btn-dark" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <form className="participant-registration-form" onSubmit={submit} noValidate>
            <p className="registration-note mb-0">Fields marked * are required. Age is calculated from date of birth.</p>
            <section className="registration-section">
              <header className="registration-section-heading">
                <span>01</span>
                <div><h3>Child details</h3><p>Start with the child’s basic information.</p></div>
              </header>
              <div className="row g-3">
                <Field label="First name" value={f.firstName} onChange={update("firstName")} required error={fieldErrors.firstName} />
                <Field label="Middle name (optional)" value={f.middleName} onChange={update("middleName")} error={fieldErrors.middleName} />
                <Field label="Last name" value={f.lastName} onChange={update("lastName")} required error={fieldErrors.lastName} />
                <Field
                  label="Date of birth"
                  type="date"
                  value={f.dateOfBirth}
                  onChange={update("dateOfBirth")}
                  required
                  error={fieldErrors.dateOfBirth}
                />
                <AgeField dateOfBirth={f.dateOfBirth} />
                <GenderSelect id="register-gender" value={f.gender} onChange={update("gender")} required error={fieldErrors.gender} />
                <Field
                  label="Home address"
                  placeholder="Street, Barangay, City"
                  value={f.address}
                  onChange={update("address")}
                />
              </div>
            </section>
            {f.participantType === "sponsored_child" && (
              <>
                <section className="registration-section registration-education-section">
                  <header className="registration-section-heading">
                    <span>02</span>
                    <div><h3>Education and school</h3><p>Add the school the child currently attends and their study details.</p></div>
                  </header>
                  <div className="row g-3">
                    <div className="col-12 col-md-6">
                      <label className="form-label" htmlFor="register-school-name">School currently attending</label>
                      <input
                        id="register-school-name"
                        className={`form-control${fieldErrors.schoolName ? " is-invalid" : ""}`}
                        value={f.schoolName}
                        onChange={update("schoolName")}
                        maxLength={200}
                        aria-invalid={fieldErrors.schoolName ? "true" : undefined}
                        aria-describedby={`register-school-name-hint${fieldErrors.schoolName ? " register-school-name-error" : ""}`}
                      />
                      {fieldErrors.schoolName && <div className="invalid-feedback d-block" id="register-school-name-error">{fieldErrors.schoolName}</div>}
                      <small className="registration-field-hint" id="register-school-name-hint">
                      Enter the full name of the school where the child is currently enrolled.
                      </small>
                    </div>
                    <div className="col-12 col-md-6">
                      <label className="form-label" htmlFor="register-education-level">Education level</label>
                      <select
                        id="register-education-level"
                        className={`form-select${fieldErrors.educationLevel ? " is-invalid" : ""}`}
                        value={f.educationLevel}
                        onChange={(event) => {
                          const level = event.target.value;
                          setFieldValue("educationLevel", level);
                          setF((current) => ({
                            ...current,
                            gradeLevel: "",
                            programCourse: level === "College" ? current.programCourse : "",
                          }));
                          setFieldErrors((current) => ({
                            ...current,
                            gradeLevel: "",
                            programCourse: "",
                          }));
                        }}
                        required
                        aria-invalid={fieldErrors.educationLevel ? "true" : undefined}
                      >
                        <option value="">Select education level</option>
                        {EDUCATION_LEVELS.map((level) => <option key={level}>{level}</option>)}
                      </select>
                      {fieldErrors.educationLevel && <div className="invalid-feedback d-block">{fieldErrors.educationLevel}</div>}
                    </div>
                    {f.educationLevel && (
                      <div className="col-12 col-md-6">
                        <label className="form-label" htmlFor="register-grade-level">
                          {f.educationLevel === "College" ? "College year" : "Grade level"}
                        </label>
                        <select
                          id="register-grade-level"
                          className={`form-select${fieldErrors.gradeLevel ? " is-invalid" : ""}`}
                          value={f.gradeLevel}
                          onChange={update("gradeLevel")}
                          required
                          aria-invalid={fieldErrors.gradeLevel ? "true" : undefined}
                        >
                          <option value="">Select {f.educationLevel === "College" ? "college year" : "grade level"}</option>
                          {GRADE_LEVELS[f.educationLevel].map((grade) => <option key={grade}>{grade}</option>)}
                        </select>
                        {fieldErrors.gradeLevel && <div className="invalid-feedback d-block">{fieldErrors.gradeLevel}</div>}
                      </div>
                    )}
                    {f.educationLevel === "College" && (
                      <Field
                        label="College program or course"
                        value={f.programCourse}
                        onChange={update("programCourse")}
                        required
                        error={fieldErrors.programCourse}
                      />
                    )}
                    <div className="col-12">
                      <label className="form-label" htmlFor="register-school-address">School address</label>
                      <textarea
                        id="register-school-address"
                        className={`form-control${fieldErrors.schoolAddress ? " is-invalid" : ""}`}
                        rows="2"
                        maxLength={500}
                        value={f.schoolAddress}
                        onChange={update("schoolAddress")}
                        aria-invalid={fieldErrors.schoolAddress ? "true" : undefined}
                      />
                      {fieldErrors.schoolAddress && <div className="invalid-feedback d-block">{fieldErrors.schoolAddress}</div>}
                    </div>
                    <div className="col-12">
                      <p className="registration-note mb-0">
                        Sponsored children must be 6–22 years old and select an education level and grade/year. College students must also provide their course.
                      </p>
                    </div>
                  </div>
                </section>
                <section className="registration-section">
                  <header className="registration-section-heading">
                    <span>03</span>
                    <div><h3>Health and emergency contact</h3><p>Provide a guardian contact for participant notifications by SMS.</p></div>
                  </header>
                  <div className="row g-3">
                    <Field label="Weight" placeholder="e.g. 32 kg" value={f.weight} onChange={update("weight")} />
                    <Field label="Height" placeholder="e.g. 132 cm" value={f.height} onChange={update("height")} />
                    <Field label="Medical conditions" value={f.medicalConditions} onChange={update("medicalConditions")} />
                    <Field label="Guardian / emergency contact name" value={f.emergencyContactName} onChange={update("emergencyContactName")} required error={fieldErrors.emergencyContactName} />
                    <Field label="Guardian mobile number" type="tel" inputMode="tel" placeholder="09xx xxx xxxx or +63 9xx xxx xxxx" value={f.emergencyContactPhone} onChange={update("emergencyContactPhone")} required error={fieldErrors.emergencyContactPhone} />
                  </div>
                </section>
              </>
            )}
            {error && <div className="alert alert-danger mt-3 mb-0" role="alert">{error}</div>}
            {duplicates.length > 0 && (
              <section className="participant-duplicate-warning" aria-labelledby="duplicate-warning-title">
                <h3 id="duplicate-warning-title">Review possible matching participants</h3>
                <p>Registration is paused so staff can check these records. Exact name-and-date matches cannot be registered again.</p>
                <ul>
                  {duplicates.map((duplicate) => (
                    <li key={duplicate.id}>
                      <strong>{duplicate.fullName}</strong>
                      {" · "}{duplicate.participantCode}
                      {" · "}{duplicate.dateOfBirth || "Date of birth unavailable"}
                      {duplicate.age !== null && duplicate.age !== undefined ? ` · Age ${duplicate.age}` : ""}
                      {duplicate.exact && <strong> · Exact match</strong>}
                    </li>
                  ))}
                </ul>
                {!duplicates.some((duplicate) => duplicate.exact) && (
                  <label className="form-check-label">
                    <input
                      className="form-check-input me-2"
                      type="checkbox"
                      checked={confirmPotentialDuplicate}
                      onChange={(event) => setConfirmPotentialDuplicate(event.target.checked)}
                    />
                    I reviewed these possible matches and confirm this is a different participant.
                  </label>
                )}
              </section>
            )}
            <footer className="participant-modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="btn btn-dark" disabled={saving || (duplicates.length > 0 && !duplicates.some((duplicate) => duplicate.exact) && !confirmPotentialDuplicate) || duplicates.some((duplicate) => duplicate.exact)}>{saving ? "Creating profile…" : confirmPotentialDuplicate ? "Confirm and create profile →" : "Create profile and QR →"}</button>
            </footer>
          </form>
        )}
      </section>
    </div>
  ), document.body);
}
function Participants({ canManage, user }) {
  const canViewSponsorship = canAccessPermission("sponsorship:view", user);
  const canManageSponsorship = canAccessPermission("sponsorship:manage", user);
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [message, setMessage] = useState("");
  const [showRegistration, setShowRegistration] = useState(false);
  const [educationFilter, setEducationFilter] = useState("all");
  const [childStatusFilter, setChildStatusFilter] = useState("all");
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
  const closeProfile = () => {
    setSelected(null);
    setForm(null);
    setEditing(false);
    setMessage("");
  };
  useEffect(() => {
    if (!form) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") closeProfile();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [form]);
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
        ...(canViewSponsorship ? {
          lifecycle: normalizeSponsorLifecycle(data.participant.sponsorship_lifecycle),
          monthlyAllowance: String(data.participant.monthly_allowance ?? 0),
        } : {}),
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
      const changes = { ...form, fullName: composeFullName(form) };
      delete changes.sponsorName;
      delete changes.sponsorContact;
      delete changes.sponsorshipType;
      if (!canManageSponsorship) {
        delete changes.lifecycle;
        delete changes.monthlyAllowance;
      }
      const data = await apiCall(`/participants/${selected}`, {
        method: "PUT",
        body: JSON.stringify(changes),
      });
      setForm({
        ...data.participant,
        participantType: data.participant.participant_type,
        ...(canViewSponsorship ? {
          lifecycle: normalizeSponsorLifecycle(data.participant.sponsorship_lifecycle),
          monthlyAllowance: String(data.participant.monthly_allowance ?? 0),
        } : {}),
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
  const searchQuery = query.trim().toLocaleLowerCase();
  const visibleParticipants = educationFilter === "all"
    ? list
    : list.filter((item) => item.education_level === educationFilter);
  const statusVisibleParticipants = childStatusFilter === "all"
    ? visibleParticipants
    : visibleParticipants.filter((item) =>
        normalizeSponsorLifecycle(item.sponsorship_lifecycle) === childStatusFilter);
  const filtered = statusVisibleParticipants.filter((item) =>
    `${item.fullName || ""} ${item.participant_code || ""} ${item.participant_type || ""} ${item.gender || ""}`
      .toLocaleLowerCase()
      .includes(searchQuery),
  );
  const sortedParticipants = [...filtered].sort((first, second) => {
    if (sortBy === "name-asc" || sortBy === "name-desc") {
      const order = (first.fullName || "").localeCompare(second.fullName || "", undefined, {
        sensitivity: "base",
      });
      return sortBy === "name-asc" ? order : -order;
    }
    if (sortBy === "age-asc" || sortBy === "age-desc") {
      const firstAge = typeof first.age === "number" && Number.isFinite(first.age) ? first.age : null;
      const secondAge = typeof second.age === "number" && Number.isFinite(second.age) ? second.age : null;
      if (firstAge === null) return secondAge === null ? 0 : 1;
      if (secondAge === null) return -1;
      return sortBy === "age-asc" ? firstAge - secondAge : secondAge - firstAge;
    }
    const firstCreated = new Date(first.created_at || 0).getTime();
    const secondCreated = new Date(second.created_at || 0).getTime();
    return sortBy === "oldest" ? firstCreated - secondCreated : secondCreated - firstCreated;
  });
  return (
    <>
      <Title
        e="PARTICIPANTS / RECORDS"
        t="Participant directory."
        d="Explore participant records, review key details, and manage sponsored-child status."
      />
      {canManage && (
        <div className="participant-register-action">
          <button type="button" className="btn btn-dark" onClick={() => setShowRegistration(true)}>
            + Register sponsored child
          </button>
        </div>
      )}
      <div className="row g-4">
        <div className="col-12">
          <div className="surface directory-panel participant-directory-panel">
            <div className="participant-directory-toolbar">
              <input
                className="form-control"
                type="search"
                aria-label="Search participants by full name"
                placeholder="Search by full name"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="participant-directory-filters">
              <div className="participant-filter-field">
                <label className="form-label" htmlFor="participants-education-type">Education type</label>
                <select
                  id="participants-education-type"
                  className="form-select"
                  value={educationFilter}
                  onChange={(event) => setEducationFilter(event.target.value)}
                >
                  <option value="all">All education types</option>
                  {EDUCATION_LEVELS.map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
              </div>
              {canViewSponsorship && (
                <div className="participant-filter-field">
                  <label className="form-label" htmlFor="participants-child-status">Child status</label>
                  <select
                    id="participants-child-status"
                    className="form-select"
                    value={childStatusFilter}
                    onChange={(event) => setChildStatusFilter(event.target.value)}
                  >
                    <option value="all">All statuses</option>
                    {SPONSOR_LIFECYCLE.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="participant-directory-sort">
                <label className="form-label" htmlFor="participants-sort">Sort by</label>
                <select
                  id="participants-sort"
                  className="form-select"
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value)}
                >
                  <option value="newest">Newest registered</option>
                  <option value="oldest">Oldest registered</option>
                  <option value="name-asc">Name (A–Z)</option>
                  <option value="name-desc">Name (Z–A)</option>
                  <option value="age-asc">Age (youngest first)</option>
                  <option value="age-desc">Age (oldest first)</option>
                </select>
              </div>
              <p className="participant-directory-count" role="status">
                {sortedParticipants.length} of {list.length} participants
              </p>
            </div>
            {sortedParticipants.map((item) => (
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
                    · {item.gender || "Sex not set"}
                  </small>
                  {item.participant_type === "goer" && (
                    <small className="participant-allowance-summary">Registration status: {item.status || "active"}</small>
                  )}
                  {canViewSponsorship && item.participant_type === "sponsored_child" && (
                    <small className="participant-allowance-summary">
                      Monthly: {formatCurrency(item.monthly_allowance)} · Available balance: {formatCurrency(item.available_allowance_balance)}
                    </small>
                  )}
                </span>
                <span className="directory-row-end">
                  {canViewSponsorship && item.participant_type === "sponsored_child" && (
                    <span className={`lifecycle-badge ${normalizeSponsorLifecycle(item.sponsorship_lifecycle)}`}>
                      {sponsorLifecycleLabel(item.sponsorship_lifecycle)}
                    </span>
                  )}
                  <span className="directory-arrow">→</span>
                </span>
              </button>
            ))}
            {!sortedParticipants.length && (
              <p className="text-secondary" role="status">
                {searchQuery ? "No participants match that name or search." : "No participants found."}
              </p>
            )}
          </div>
        </div>
      </div>
        {form && createPortal(
          <div
            className="participant-modal-backdrop participant-profile-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeProfile();
            }}
          >
            <section className="participant-modal participant-profile-modal" role="dialog" aria-modal="true" aria-labelledby="participant-profile-title">
          {form && !editing ? (
            <div className="participant-qr-card participant-profile-card">
              <div className="d-flex justify-content-between align-items-start mb-3">
                <div>
                  <span className="eyebrow">DIGITAL PARTICIPANT ID</span>
                  <h2 id="participant-profile-title">{form.fullName}</h2>
                  <p className="text-secondary mb-0">
                    {form.participantType === "sponsored_child"
                      ? `Sponsored Child · ${sponsorLifecycleLabel(form.sponsorship_lifecycle)}`
                      : `Goer · ${form.status}`}
                  </p>
                  <p className="text-secondary mt-2 mb-0">{form.participant_code} · <AgeValue dateOfBirth={form.dateOfBirth} /></p>
                </div>
                <button type="button" className="btn-close" aria-label="Close participant profile" onClick={closeProfile} />
              </div>
              <div className="participant-profile-actions">
                {canManage && <button type="button" className="btn btn-dark" onClick={() => { setMessage(""); setEditing(true); }}>Edit details</button>}
                {canManage && <button type="button" className="btn btn-outline-danger" onClick={deleteParticipant}>Delete participant</button>}
              </div>
              {form.participantType === "sponsored_child" && form.qr_code_image ? <img className="participant-qr-image" src={`/${form.qr_code_image}`} alt={`QR code for ${form.participant_code}`} /> : form.participantType === "sponsored_child" ? <p className="text-secondary">No active QR code found.</p> : null}
              {form.participantType === "sponsored_child" && form.qr_code_image && <div className="d-flex flex-wrap gap-2">
                <button type="button" className="btn btn-dark" onClick={() => window.print()}>Print QR card</button>
              </div>}
              {message && <div className="alert alert-info mt-3 mb-0" role="status">{message}</div>}
              {canViewSponsorship && form.participantType === "sponsored_child" && (
                <div className="profile-grid mt-4">
                  <div><small>Child status</small><strong>{sponsorLifecycleLabel(form.sponsorship_lifecycle)}</strong></div>
                  <div><small>Monthly allowance</small><strong>{formatCurrency(form.monthly_allowance)}</strong></div>
                  <div><small>Available sponsorship allowance balance</small><strong>{formatCurrency(form.available_allowance_balance)}</strong></div>
                </div>
              )}
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
              <div className="profile-grid">
                  {[
                    ["Name", form.fullName],
                    ["Sex", form.gender],
                    ["Date of birth", form.dateOfBirth],
                    ["Age", <AgeValue key="age" dateOfBirth={form.dateOfBirth} />],
                    ["Education", form.educationLevel],
                    ["Grade/year", form.gradeLevel],
                    ["College course", form.programCourse],
                    ["School name", form.schoolName],
                    ["School address", form.schoolAddress],
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
            </div>
          ) : (
            <form className="participant-profile-edit" onSubmit={save}>
              <div className="d-flex justify-content-between align-items-start mb-3">
                <div>
                  <span className="eyebrow">
                    EDITING {form.participant_code}
                  </span>
                  <h2 id="participant-profile-title">Edit participant details</h2>
                      <p className="text-secondary mb-0">
                        Type: {form.participantType === "sponsored_child" ? "Sponsored Child" : "Existing Goer participant record"}
                      </p>
                </div>
                <button type="button" className="btn-close" aria-label="Close participant editor" onClick={() => { setEditing(false); setMessage(""); }} />
              </div>
              {form.participantType === "goer" && (
                <div className="participant-account-status">
                  <label className="form-label" htmlFor="edit-participant-status">Registration status</label>
                  <select id="edit-participant-status" className="form-select" value={form.status || "active"} onChange={update("status")}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              )}
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
                <AgeField dateOfBirth={form.dateOfBirth} />
                <GenderSelect
                  id="edit-gender"
                  value={form.gender}
                  onChange={update("gender")}
                />
                {canManageSponsorship && form.participantType === "sponsored_child" && (
                  <>
                    <div className="col-12 col-md-6">
                      <label className="form-label" htmlFor="edit-child-lifecycle">Child status</label>
                      <select id="edit-child-lifecycle" className="form-select" value={normalizeSponsorLifecycle(form.lifecycle)} onChange={update("lifecycle")}>
                        {SPONSOR_LIFECYCLE.map(({ value, label }) => <option value={value} key={value}>{label}</option>)}
                      </select>
                      <small className="participant-status-description">
                        {SPONSOR_LIFECYCLE.find(({ value }) => value === normalizeSponsorLifecycle(form.lifecycle))?.description}
                      </small>
                    </div>
                    <Field label="Monthly allowance (PHP)" type="number" min="0" max="1000000" step="0.01" value={form.monthlyAllowance ?? "0"} onChange={update("monthlyAllowance")} />
                  </>
                )}
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
                      label="School name"
                      value={form.schoolName || ""}
                      onChange={update("schoolName")}
                      maxLength={200}
                    />
                    <div className="col-12">
                      <label className="form-label" htmlFor="edit-school-address">School address</label>
                      <textarea
                        id="edit-school-address"
                        className="form-control"
                        rows="2"
                        maxLength={500}
                        value={form.schoolAddress || ""}
                        onChange={update("schoolAddress")}
                      />
                    </div>
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
                      label="Enrollment date"
                      type="date"
                      value={(form.enrollmentDate || "").slice(0, 10)}
                      onChange={update("enrollmentDate")}
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
              <button type="button" className="btn btn-link text-secondary mt-4 ms-2" onClick={() => { setEditing(false); setMessage(""); }}>
                Cancel
              </button>
              {message && (
                <div className="alert alert-info mt-3 mb-0">{message}</div>
              )}
            </form>
          )}
            </section>
          </div>,
          document.body,
        )}
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
  if (screen === "sponsor") {
    return <PublicLookup onBack={() => setScreen("home")} />;
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
          <span className="public-home-kicker"><span /> FMC FIELD CARE · COMMUNITY FIRST</span>
          <h1>Care that<br /><em>moves lives forward.</em></h1>
          <p>One caring community. Every child supported, every milestone celebrated, and every story connected.</p>
          <div className="public-home-actions">
            <button type="button" className="public-home-primary-action" onClick={() => setScreen("sponsor")}>
              Visit guardian space <span aria-hidden="true">↗</span>
            </button>
            <button type="button" className="public-home-secondary-action" onClick={() => setScreen("staff")}>
              Staff & Goer sign in <span aria-hidden="true">→</span>
            </button>
          </div>
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
          <span className="public-home-section-caption">Choose a secure space to continue</span>
        </div>
        <div className="public-access-grid">
        <button className="public-access-card public-access-staff" onClick={() => setScreen("staff")}>
          <span className="public-access-card-top"><span className="public-access-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z" /><path d="M8 9h8M8 13h5M8 17h3" /></svg>
          </span><span className="public-access-number">01 / STAFF</span></span>
          <strong>Staff & Goers</strong>
          <span>Sign in to manage care, record attendance, and support your assigned group.</span>
          <b>Continue to sign in <span aria-hidden="true">↗</span></b>
        </button>
        <button className="public-access-card public-access-guardian" onClick={() => setScreen("sponsor")}>
          <span className="public-access-card-top"><span className="public-access-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M20.8 8.7c0 5.4-8.8 11-8.8 11s-8.8-5.6-8.8-11A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.6Z" /><path d="M8.5 12h2l1.2-2.2 1.7 4.4 1.1-2.2h1" /></svg>
          </span><span className="public-access-number">02 / GUARDIAN</span></span>
          <strong>Sponsored Child Guardian</strong>
          <span>See your child’s sponsorship status with their QR code and passcode.</span>
          <b>Check sponsorship <span aria-hidden="true">↗</span></b>
        </button>
        </div>
      </section>
      <footer className="public-home-footer">
        <span><span className="public-home-lock" aria-hidden="true">◆</span> Your information is handled with care.</span>
        <span>Guardian access requires the child’s active QR code and passcode.</span>
      </footer>
    </main>
  );
}
function PublicLookup({ onBack }) {
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
      value === lastScannedPayload.current &&
      Date.now() - lastScannedAt.current < 2500
    ) return;
    lastScannedPayload.current = value;
    lastScannedAt.current = Date.now();
    setPayload(value);
    setPasscode("");
    setError("");
    setPasscodeOpen(true);
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
    if (!/^\d{6}$/.test(passcode)) {
      setError("Enter the 6-digit child passcode.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(`${api}/public/sponsor-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrPayload: payload.trim(), passcode }),
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
    setError("");
    setPasscodeOpen(true);
  };
  return (
    <>
    <main className="public-home public-lookup">
      <button type="button" className="public-lookup-back-button" onClick={onBack}>
        <span aria-hidden="true">←</span>
        Back to home
      </button>
      <section className="public-lookup-heading">
        <span className="eyebrow">GUARDIAN SPACE</span>
        <h1>Your child’s journey.</h1>
        <p>Scan the Sponsored Child’s QR code. You’ll be asked for the passcode after scanning.</p>
      </section>
      {!result ? (
        <form className="surface public-lookup-form" onSubmit={submit}>
          <p className="form-label mb-2">Scan the child’s QR code with your camera</p>
          {!passcodeOpen && (
            <Camera
              id="public-sponsor-qr"
              onScan={onQrScanned}
              errorMessage="Camera unavailable. Grant camera permission to scan the child’s QR code."
            />
          )}
          {error && <div className="alert alert-danger" role="alert">{error}</div>}
        </form>
      ) : (
        <section className="surface public-result" aria-live="polite">
          <span className="eyebrow">VERIFIED CHILD</span>
          <h2>{result.child.name}</h2>
          <p className="text-secondary">Participant ID: {result.child.participantCode}</p>
          <GuardianSponsoredDetails
            child={result.child}
            qrPayload={payload}
            passcode={passcode}
          />
          <button className="btn btn-outline-dark mt-4" onClick={() => { setResult(null); setPasscode(""); setPayload(""); setPasscodeOpen(false); lastScannedPayload.current = ""; lastScannedAt.current = 0; }}>Look up another</button>
        </section>
      )}
    </main>
    {passcodeOpen && createPortal(
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
  const [updates, setUpdates] = useState([]);
  const [loadingUpdates, setLoadingUpdates] = useState(false);
  const [updatesLoaded, setUpdatesLoaded] = useState(false);
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
      setProof({ ...data, name: `Receipt for ${record.disbursedOn}` });
    } catch (proofError) {
      setError(proofError.message);
    }
  };

  const loadUpdates = async () => {
    if (updatesLoaded || loadingUpdates) return;
    setLoadingUpdates(true);
    setError("");
    try {
      const response = await fetch(`${api}/public/sponsor-updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrPayload, passcode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load your child's updates.");
      setUpdates(data.updates || []);
      setUpdatesLoaded(true);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoadingUpdates(false);
    }
  };

  return (
    <div className="guardian-sponsored-details">
      <div className="guardian-portal-tabs" role="tablist" aria-label="Sponsored child information">
        <button type="button" className={section === "allowance" ? "active" : ""} role="tab" aria-selected={section === "allowance"} onClick={() => setSection("allowance")}>Allowance &amp; gifts</button>
        <button type="button" className={section === "updates" ? "active" : ""} role="tab" aria-selected={section === "updates"} onClick={() => { setSection("updates"); loadUpdates(); }}>Updates</button>
        <button type="button" className={section === "letters" ? "active" : ""} role="tab" aria-selected={section === "letters"} onClick={() => setSection("letters")}>Letters {threads.length > 0 && <span>{threads.length}</span>}</button>
      </div>
      {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      {section === "allowance" ? (
        <section className="guardian-allowance-section">
          <h3 className="public-attendance-title">Allowance and gifts</h3>
          {child.disbursements?.length ? (
            <div className="table-responsive">
              <table className="table align-middle">
                <thead><tr><th>Date</th><th>Amount</th><th>Proof</th></tr></thead>
                <tbody>{child.disbursements.map((record) => (
                  <tr key={record.id}>
                    <td>{new Date(record.disbursedOn).toLocaleDateString()}</td>
                    <td>{formatCurrency(record.amount)}</td>
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
      ) : section === "updates" ? (
        <section className="guardian-updates-section">
          <div className="guardian-updates-heading">
            <div>
              <h3>Growth &amp; activity</h3>
              <p>Measurements, activities attended, and care notes recorded for {child.name}.</p>
            </div>
          </div>
          {loadingUpdates ? (
            <p role="status">Loading updates...</p>
          ) : updates.length ? (
            <div className="guardian-update-list">
              {updates.map((update) => (
                <article className={`guardian-update-card update-${update.type}`} key={update.id}>
                  <div className="guardian-update-icon" aria-hidden="true">
                    {update.type === "growth" ? "✦" : update.type === "activity" ? "▣" : "✎"}
                  </div>
                  <div className="guardian-update-body">
                    <div className="guardian-update-top">
                      <strong>{update.type === "growth" ? "Growth measurement" : update.type === "activity" ? "Activity attended" : "Care note"}</strong>
                      <time>{new Date(`${update.recordedOn}T00:00:00`).toLocaleDateString()}</time>
                    </div>
                    {update.type === "growth" && (update.heightCm || update.weightKg) && (
                      <div className="guardian-update-metrics">
                        {update.heightCm && <span className="metric-height">{update.heightCm} cm</span>}
                        {update.weightKg && <span className="metric-weight">{update.weightKg} kg</span>}
                      </div>
                    )}
                    {update.type === "activity" && update.activity && (
                      <p className="guardian-update-activity">{update.activity}</p>
                    )}
                    {update.note && <p className="guardian-update-note">{update.note}</p>}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-secondary">No growth, activity, or care updates recorded yet.</p>
          )}
        </section>
      ) : (
        <section className="guardian-letters-section">
          <div className="guardian-letters-heading">
            <div>
              <h3>Letters</h3>
              <p>View past messages with the church, or write a new letter.</p>
            </div>
            <button type="button" className="guardian-new-letter-btn" onClick={() => setThreadId(null)}>
              <span aria-hidden="true">✉</span> New letter
            </button>
          </div>
          <div className="guardian-letters-body">
            <div className="guardian-letter-list">
              {loadingLetters ? <p role="status">Loading your letters...</p> : threads.map((thread) => (
                <button type="button" className={`sponsorship-thread-row ${Number(threadId) === Number(thread.id) ? "selected" : ""}`} key={thread.id} onClick={() => setThreadId(thread.id)}>
                  <strong>{thread.subject}</strong><span>{thread.status}</span><small>{new Date(thread.updated_at).toLocaleDateString()}{thread.messages?.length ? ` · ${thread.messages.length} message${thread.messages.length === 1 ? "" : "s"}` : ""}</small>
                </button>
              ))}
              {!loadingLetters && !threads.length && <p className="text-secondary">No letters yet. Send a message to get started.</p>}
            </div>
            {selectedThread ? (
              <div className="guardian-thread-conversation">
                <h3>{selectedThread.subject}</h3>
                <div className="sponsorship-messages">{selectedThread.messages.map((entry) => (
                  <div className={`sponsorship-message ${entry.sender_type}`} key={entry.id}>
                    <span>{entry.sender_type === "staff" ? "Church staff" : "You"} · {new Date(entry.created_at).toLocaleString()}</span>
                    <p>{entry.message}</p>
                  </div>
                ))}</div>
              </div>
            ) : (
              !loadingLetters && threads.length > 0 && (
                <div className="guardian-no-selection">Select a letter on the left to view past messages, or tap <strong>New letter</strong> to write one.</div>
              )
            )}
          </div>
          <form className="guardian-letter-form" onSubmit={sendLetter}>
            <div className="sponsor-letter-paper">
              <header className="sponsor-letter-paper-header">
                <div className="sponsor-letter-recipient">
                  <strong>{child.name}</strong>
                  <span>Participant ID: {child.participantCode}</span>
                </div>
                <div className="sponsor-letter-date">
                  <span>Date</span>
                  <time>{new Date().toLocaleDateString()}</time>
                </div>
              </header>
              <div className="sponsor-letter-paper-title">
                <span className={`guardian-letter-mode ${selectedThread && selectedThread.status !== "closed" ? "mode-reply" : "mode-new"}`}>
                  {selectedThread && selectedThread.status !== "closed" ? "Reply to thread" : "New letter for your child"}
                </span>
                <h3>Mensahe para sa aking sponsor</h3>
                <p>(A message to my sponsor)</p>
              </div>
              {(!selectedThread || selectedThread.status === "closed") && (
                <div className="sponsor-letter-subject">
                  <label className="form-label" htmlFor="guardian-letter-subject">Paksa / Subject</label>
                  <input id="guardian-letter-subject" className="form-control" maxLength={160} required value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="What would you like to share?" />
                </div>
              )}
              <div className="sponsor-letter-writing">
                <label className="form-label" htmlFor="guardian-letter-message">
                  {selectedThread && selectedThread.status !== "closed" ? "Reply / Sagot" : "Mensahe / Message"}
                </label>
                <textarea
                  id="guardian-letter-message"
                  className="form-control sponsor-letter-message"
                  rows="12"
                  maxLength={5000}
                  required
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Isulat ang iyong mensahe dito…"
                />
              </div>
            </div>
            <button className="btn btn-dark sponsor-letter-send" disabled={sending}>{sending ? "Sending…" : selectedThread && selectedThread.status !== "closed" ? "Send reply" : "Send letter"}</button>
          </form>
        </section>
      )}
    </div>
  );
}
function Scanner({ portal = false, user = null }) {
  const isGoer = String(user?.role || "").toLowerCase() === GOER_ROLE;
  const [payload, setPayload] = useState("");
  const [toast, setToast] = useState(null);
  const [pass, setPass] = useState("");
  const [requiresPasscode, setRequiresPasscode] = useState(false);
  const [profile, setProfile] = useState(null);
  const [event, setEvent] = useState("custom");
  const [attendanceAction, setAttendanceAction] = useState("check_in");
  const [events, setEvents] = useState([]);
  const [groupRoster, setGroupRoster] = useState(null);
  const [groupRosterLoading, setGroupRosterLoading] = useState(isGoer);
  const [groupRosterError, setGroupRosterError] = useState("");
  const portalBusy = useRef(false);
  const checkinBusy = useRef(false);
  useEffect(() => {
    if (!portal) apiCall("/checkin/events").then(setEvents).catch(() => {});
  }, [portal]);
  const fetchGoerRoster = useCallback(() => apiCall("/checkin/group"), []);
  useEffect(() => {
    if (portal || !isGoer) return undefined;
    let mounted = true;
    fetchGoerRoster()
      .then((result) => {
        if (!mounted) return;
        setGroupRoster(result);
        setGroupRosterError("");
        setGroupRosterLoading(false);
      })
      .catch((error) => {
        if (!mounted) return;
        setGroupRosterError(error.message);
        setGroupRosterLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [fetchGoerRoster, isGoer, portal]);
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
    if (isGoer) {
      fetchGoerRoster()
        .then((roster) => {
          setGroupRoster(roster);
          setGroupRosterError("");
        })
        .catch((error) => setGroupRosterError(error.message));
    }
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
              <small>Age</small>
              <strong><AgeValue dateOfBirth={profile.dateOfBirth} /></strong>
            </div>
            <div>
              <small>Sex</small>
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
              <div><small>School</small><strong>{profile.schoolName || "Not provided"}</strong></div>
              <div><small>School address</small><strong>{profile.schoolAddress || "Not provided"}</strong></div>
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
      {portal ? (
        <Title
          e="SPONSORED CHILD PORTAL"
          t="A private window into care."
          d="Use the device camera or enter a QR payload."
        />
      ) : (
        <section className={`checkin-hero${isGoer ? " checkin-hero-goer" : ""}`}>
          <div className="checkin-hero-copy">
            <span className="checkin-hero-kicker"><span aria-hidden="true">●</span> {isGoer ? "GROUP ATTENDANCE" : "COMMUNITY CHECK-IN"}</span>
            <h1>{isGoer ? "Welcome your group." : "Every arrival matters."}</h1>
            <p>{isGoer
              ? `Record attendance for your ${user.goerEducationLevel} group with a quick, secure scan.`
              : "A warm welcome starts here. Scan a participant QR code to record their attendance."}</p>
          </div>
          <div className="checkin-hero-side" aria-hidden="true">
            <span className="checkin-hero-ring checkin-hero-ring-one" />
            <span className="checkin-hero-ring checkin-hero-ring-two" />
            <span className="checkin-hero-symbol">✓</span>
            <span className="checkin-hero-chip">READY TO WELCOME</span>
          </div>
        </section>
      )}
      <div className={`row g-4 scanner-workspace${portal ? " scanner-workspace-portal" : ""}`}>
        <div className="col-12 col-md-6">
          <div className={`surface scanner-card${portal ? "" : " checkin-scan-card"}`}>
            {!portal && <div className="checkin-card-heading">
              <div><span className="checkin-step">STEP 01</span><h2>Scan participant</h2><p>Position the QR code inside the camera frame.</p></div>
              <span className="checkin-live-indicator"><i /> QR SCAN</span>
            </div>}
            <Camera
              id={portal ? "portal-camera" : "station-camera"}
              onScan={scan}
            />
            <label className="checkin-payload-label" htmlFor={portal ? "portal-payload" : "station-payload"}>
              {portal ? "Or paste QR payload" : "Can’t scan? Enter the QR code manually"}
            </label>
            <div className="checkin-payload-field">
              <span aria-hidden="true">⌁</span>
              <input
                id={portal ? "portal-payload" : "station-payload"}
                className="form-control"
                placeholder="Paste or type QR payload"
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
        </div>
        <div className="col-12 col-md-6">
          <div className={`surface form-surface${portal ? "" : " checkin-settings-card"}`}>
            {portal ? (
              <>
                {requiresPasscode && <input className="form-control mb-3" type="password" placeholder="Sponsored Child passcode" value={pass} onChange={(e) => setPass(e.target.value)} />}
              </>
            ) : (
              <>
                <div className="checkin-card-heading checkin-settings-heading">
                  <div><span className="checkin-step">STEP 02</span><h2>Set up attendance</h2><p>Choose the event and what you’re recording.</p></div>
                  <span className="checkin-settings-icon" aria-hidden="true">⚙</span>
                </div>
                <div className="checkin-setting-field">
                  <label className="form-label" htmlFor="checkin-event">Event</label>
                  <select id="checkin-event" className="form-select" value={event} onChange={(e) => setEvent(e.target.value)}>
                    <option value="custom">Sunday service (custom)</option>
                    {events.map((item) => <option key={item.id} value={String(item.id)}>{item.name} · {new Date(item.starts_at).toLocaleString()}</option>)}
                  </select>
                </div>
                {selectedEvent?.location && (
                  <div className="checkin-location"><span aria-hidden="true">⌖</span><span>Event location<strong>{selectedEvent.location}</strong></span></div>
                )}
                <div className="checkin-setting-field checkin-action-field">
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
                  <small className="checkin-helper-text">
                    {attendanceAction === "check_out"
                      ? "Only participants with an active check-in for this event can check out."
                      : "Check-in records the participant’s arrival for the selected event."}
                  </small>
                </div>
              </>
            )}
            <button
              className={`btn btn-dark mt-3 w-100${portal ? "" : " checkin-submit-button"}`}
              disabled={!payload}
              onClick={send}
            >
              {portal ? "Verify and open profile" : attendanceAction === "check_out" ? "Record check-out" : "Record check-in"} →
            </button>
            {!portal && <p className="checkin-privacy-note"><span aria-hidden="true">◇</span> QR details are used only to verify and record attendance.</p>}
            {/* Toast handled separately */}
          </div>
        </div>
      </div>
      {!portal && isGoer && (
        <section className="surface table-surface staff-list-panel mt-4 checkin-roster">
          <div className="panel-title">
            <div><span className="checkin-step">TODAY’S OVERVIEW</span><h2>{groupRoster?.educationLevel || user.goerEducationLevel} group attendance</h2></div>
            <span className="checkin-roster-count">{groupRoster?.children.length ?? 0} children</span>
          </div>
          {groupRosterError && <div className="alert alert-danger" role="alert">{groupRosterError}</div>}
          {groupRosterLoading ? <p role="status">Loading group attendance...</p> : groupRoster?.children.length ? (
            <div className="table-responsive">
              <table className="table align-middle">
                <thead><tr><th>Child</th><th>Grade/year</th><th>Today’s attendance</th></tr></thead>
                <tbody>{groupRoster.children.map((child) => (
                  <tr key={child.id}>
                    <td><strong>{child.name}</strong><small className="d-block text-secondary">{child.participantCode}</small></td>
                    <td>{child.gradeLevel || "—"}</td>
                    <td>{child.checkedInAt
                      ? <>{child.checkedOutAt ? "Checked out" : "Checked in"} · {child.attendanceEvent}<small className="d-block text-secondary">{new Date(child.checkedOutAt || child.checkedInAt).toLocaleTimeString()}</small></>
                      : <span className="text-secondary">No attendance recorded today</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : !groupRosterError ? <p className="text-secondary">No active sponsored children are assigned to this group.</p> : null}
        </section>
      )}
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
  const [showCreate, setShowCreate] = useState(false);
  const [savingEvent, setSavingEvent] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", startsAt: "", endsAt: "", location: "" });
  const createPhotoInput = useRef(null);
  const modalPhotoInput = useRef(null);
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  const load = () => apiCall("/events").then(setEvents).catch((error) => setMessage(error.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!selected && !showCreate) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        if (showCreate) setShowCreate(false);
        else setSelected(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selected, showCreate]);
  const create = async (event) => {
    event.preventDefault();
    setSavingEvent(true);
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
      setShowCreate(false);
      setMessage("Event schedule created.");
      await load();
    } catch (error) { setMessage(error.message); }
    finally { setSavingEvent(false); }
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
  const EventCard = ({ item }) => {
    const starts = new Date(item.starts_at);
    const day = starts.getDate();
    const month = starts.toLocaleString(undefined, { month: "short" });
    const startTime = starts.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return (
      <article className="event-card">
        <div className="event-card-date">
          <strong>{day}</strong>
          <span>{month}</span>
        </div>
        <div className="event-card-body">
          <strong>{item.name}</strong>
          <small>{startTime}{item.location ? ` · ${item.location}` : ""}</small>
          {item.description && <p>{item.description}</p>}
          {item.photo_count > 0 && <span className="event-card-photos">{item.photo_count} photo{item.photo_count === 1 ? "" : "s"}</span>}
        </div>
        <button className="btn btn-sm btn-outline-dark event-card-btn" onClick={() => viewAttendance(item.id)}>View attendance</button>
      </article>
    );
  };
  return <>
    <Title e="EVENTS / SCHEDULE" t="Plan every gathering." d="Create event schedules and review attendance from completed events." />
    {message && (
      <div className="alert alert-info d-flex justify-content-between align-items-center" role="status">
        <span>{message}</span>
        <button type="button" className="btn-close" aria-label="Dismiss message" onClick={() => setMessage("")} />
      </div>
    )}
    <div className="events-toolbar">
      <div>
        <h2>Event schedule</h2>
        <p>{events.length} event{events.length === 1 ? "" : "s"} · {upcoming.length} upcoming</p>
      </div>
      {canManage && (
        <button type="button" className="event-create-btn" onClick={() => setShowCreate(true)}>
          <span className="event-create-btn-icon" aria-hidden="true">＋</span> Create event
        </button>
      )}
    </div>
    <div className="events-grid">
      <section className="events-column">
        <div className="events-column-heading"><h3>Upcoming events</h3><span>{upcoming.length}</span></div>
        {upcoming.length ? upcoming.map((item) => <EventCard item={item} key={item.id} />) : <div className="events-empty">No upcoming events.</div>}
      </section>
      <section className="events-column">
        <div className="events-column-heading"><h3>Past events</h3><span>{past.length}</span></div>
        {past.length ? past.map((item) => <EventCard item={item} key={item.id} />) : <div className="events-empty">No past events.</div>}
      </section>
    </div>
    {showCreate && createPortal(
      <div className="event-modal-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setShowCreate(false);
      }}>
        <section className="event-modal event-create-modal" role="dialog" aria-modal="true" aria-labelledby="event-create-title">
          <header className="event-modal-header">
            <div>
              <span className="eyebrow">EVENT SCHEDULE / NEW</span>
              <h2 id="event-create-title">Create event</h2>
              <p>Add a new gathering to the church schedule.</p>
            </div>
            <button type="button" className="btn-close" aria-label="Close create event" onClick={() => setShowCreate(false)} />
          </header>
          <form className="event-create-form" onSubmit={create}>
            <div className="event-create-field">
              <label className="form-label" htmlFor="event-create-name">Event name</label>
              <input id="event-create-name" className="form-control" required value={form.name} onChange={update("name")} />
            </div>
            <div className="event-create-field">
              <label className="form-label" htmlFor="event-create-location">Location</label>
              <input id="event-create-location" className="form-control" value={form.location} onChange={update("location")} />
            </div>
            <div className="event-create-field">
              <label className="form-label" htmlFor="event-create-starts">Starts</label>
              <input id="event-create-starts" className="form-control" type="datetime-local" required value={form.startsAt} onChange={update("startsAt")} />
            </div>
            <div className="event-create-field">
              <label className="form-label" htmlFor="event-create-ends">Ends</label>
              <input id="event-create-ends" className="form-control" type="datetime-local" value={form.endsAt} onChange={update("endsAt")} />
            </div>
            <div className="event-create-full">
              <label className="form-label" htmlFor="event-create-description">Description</label>
              <textarea id="event-create-description" className="form-control" rows="3" value={form.description} onChange={update("description")} />
            </div>
            <div className="event-create-full">
              <label className="form-label" htmlFor="event-create-photos">Event photos (optional, up to 5)</label>
              <input
                ref={createPhotoInput}
                id="event-create-photos"
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
            <div className="event-create-actions">
              <button type="button" className="btn btn-outline-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-dark" type="submit" disabled={savingEvent}>{savingEvent ? "Saving…" : "Save event schedule"}</button>
            </div>
          </form>
        </section>
      </div>,
      document.body,
    )}
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
function Analytics({ user }) {
  const canExportReports = canAccessPermission("reports:view", user);
  const canViewSponsorship = canAccessPermission("sponsorship:view", user);
  const isSystemAdmin = String(user?.role).toLowerCase() === "system administrator";
  const dateInput = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const defaultRangeStart = new Date();
  defaultRangeStart.setDate(defaultRangeStart.getDate() - 89);
  const [from, setFrom] = useState(dateInput(defaultRangeStart));
  const [to, setTo] = useState(dateInput(new Date()));
  const [participantType, setParticipantType] = useState("all");
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [trendInterval, setTrendInterval] = useState("week");
  const [trendEvent, setTrendEvent] = useState("");
  const [trends, setTrends] = useState([]);
  const [trendEvents, setTrendEvents] = useState([]);
  const [trendsLoading, setTrendsLoading] = useState(true);
  const trendCanvas = useRef(null);
  const [validation, setValidation] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [riskRows, setRiskRows] = useState([]);
  const [riskLevel, setRiskLevel] = useState("all");
  const [riskLoading, setRiskLoading] = useState(true);
  const [sponsoredFilters, setSponsoredFilters] = useState({ educationLevel: "", gradeLevel: "", sponsorshipStatus: "", riskLevel: "" });
  const [sponsoredRows, setSponsoredRows] = useState([]);
  const [sponsoredLoading, setSponsoredLoading] = useState(true);
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reportType, setReportType] = useState("attendance");
  const [reportFormat, setReportFormat] = useState("csv");
  const [reportPassword, setReportPassword] = useState("");
  const [exportParticipantId, setExportParticipantId] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [decryptFile, setDecryptFile] = useState(null);
  const [decryptPassword, setDecryptPassword] = useState("");
  const [decryptBusy, setDecryptBusy] = useState(false);
  const [decryptError, setDecryptError] = useState("");
  const [decryptMessage, setDecryptMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    setOverviewLoading(true);
    apiCall(`/analytics/overview?from=${from}&to=${to}&participantType=${participantType}`)
      .then((data) => { if (mounted) setOverview(data); })
      .catch((fetchError) => { if (mounted) setLoadError(fetchError.message); })
      .finally(() => { if (mounted) setOverviewLoading(false); });
    return () => { mounted = false; };
  }, [from, to, participantType]);

  useEffect(() => {
    let mounted = true;
    setTrendsLoading(true);
    apiCall(`/analytics/trends?from=${from}&to=${to}&participantType=${participantType}&interval=${trendInterval}&event=${encodeURIComponent(trendEvent)}`)
      .then((data) => {
        if (!mounted) return;
        setTrends(data.records || []);
        setTrendEvents(data.events || []);
      })
      .catch((fetchError) => { if (mounted) setLoadError(fetchError.message); })
      .finally(() => { if (mounted) setTrendsLoading(false); });
    return () => { mounted = false; };
  }, [from, to, participantType, trendInterval, trendEvent]);

  useEffect(() => {
    let mounted = true;
    setRiskLoading(true);
    apiCall(`/analytics/risk?riskLevel=${riskLevel}`)
      .then((data) => { if (mounted) setRiskRows(data.records || []); })
      .catch((fetchError) => { if (mounted) setLoadError(fetchError.message); })
      .finally(() => { if (mounted) setRiskLoading(false); });
    return () => { mounted = false; };
  }, [riskLevel]);

  useEffect(() => {
    let mounted = true;
    setSponsoredLoading(true);
    Promise.all([
      apiCall("/risk-scores/validation"),
      ...(canViewSponsorship ? [apiCall(`/analytics/sponsored-children?educationLevel=${encodeURIComponent(sponsoredFilters.educationLevel)}&gradeLevel=${encodeURIComponent(sponsoredFilters.gradeLevel)}&sponsorshipStatus=${encodeURIComponent(sponsoredFilters.sponsorshipStatus)}&riskLevel=${sponsoredFilters.riskLevel}`)] : []),
    ])
      .then(([validationReport, sponsored]) => {
        if (!mounted) return;
        setValidation(validationReport);
        if (canViewSponsorship && sponsored) setSponsoredRows(sponsored.records || []);
      })
      .catch((fetchError) => { if (mounted) setLoadError(fetchError.message); })
      .finally(() => { if (mounted) setSponsoredLoading(false); });
    return () => { mounted = false; };
  }, [canViewSponsorship, sponsoredFilters.educationLevel, sponsoredFilters.gradeLevel, sponsoredFilters.sponsorshipStatus, sponsoredFilters.riskLevel]);

  useEffect(() => {
    if (!history && !historyLoading) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setHistory(null);
        setHistoryLoading(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [history, historyLoading]);

  useEffect(() => {
    if (!trendCanvas.current || trends.length === 0) return;
    const chart = new Chart(trendCanvas.current, {
      type: "line",
      data: {
        labels: trends.map((row) => row.label),
        datasets: [
          {
            label: "Sponsored children",
            data: trends.map((row) => row.sponsoredCheckIns),
            borderColor: "#0d5c9e",
            backgroundColor: "rgba(13,92,158,.14)",
            fill: true,
            tension: 0.3,
            pointRadius: 2,
          },
          {
            label: "Church goers",
            data: trends.map((row) => row.goerCheckIns),
            borderColor: "#75a84c",
            backgroundColor: "rgba(117,168,76,.14)",
            fill: true,
            tension: 0.3,
            pointRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "bottom" } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
    return () => chart.destroy();
  }, [trends]);

  const handleFromChange = (value) => {
    setFrom(value);
    if (value && to && value > to) setTo(value);
  };
  const handleToChange = (value) => {
    setTo(value);
    if (value && from && value < from) setFrom(value);
  };

  const refreshModel = async () => {
    setRefreshing(true);
    setLoadError("");
    try {
      const report = await apiCall("/risk-scores/refresh", { method: "POST" });
      setValidation(report.validation);
      const riskData = await apiCall(`/analytics/risk?riskLevel=${riskLevel}`);
      setRiskRows(riskData.records || []);
    } catch (refreshError) {
      setLoadError(refreshError.message);
    } finally {
      setRefreshing(false);
    }
  };

  const openHistory = async (participantId) => {
    setHistory(null);
    setHistoryLoading(true);
    try {
      const data = await apiCall(`/analytics/participants/${participantId}/history`);
      setHistory(data);
    } catch (historyError) {
      setLoadError(historyError.message);
    } finally {
      setHistoryLoading(false);
    }
  };

  const trendTotals = trends.reduce((acc, row) => ({
    totalCheckIns: acc.totalCheckIns + row.totalCheckIns,
    sponsoredCheckIns: acc.sponsoredCheckIns + row.sponsoredCheckIns,
    goerCheckIns: acc.goerCheckIns + row.goerCheckIns,
  }), { totalCheckIns: 0, sponsoredCheckIns: 0, goerCheckIns: 0 });

  const downloadReport = async () => {
    setExportBusy(true);
    setExportError("");
    try {
      const params = new URLSearchParams({ format: reportFormat });
      if (reportPassword) params.set("password", reportPassword);
      let path = "";
      if (reportType === "attendance") {
        params.set("from", from);
        params.set("to", to);
        params.set("participantType", participantType);
        params.set("interval", trendInterval);
        if (trendEvent) params.set("event", trendEvent);
        path = "analytics-attendance";
      } else if (reportType === "at-risk") {
        params.set("riskLevel", riskLevel);
        path = "at-risk";
      } else if (reportType === "participant-history") {
        if (!exportParticipantId) {
          setExportError("Select a participant to export.");
          setExportBusy(false);
          return;
        }
        params.set("participantId", exportParticipantId);
        path = "participant-history";
      } else {
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        path = "audit-trail";
      }
      const response = await fetch(`${api}/reports/${path}?${params.toString()}`, { headers: { Authorization: `Bearer ${localStorage.token}` } });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Could not generate the report.");
      }
      const blob = await response.blob();
      const extension = reportPassword ? "enc" : reportFormat;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${reportType}-${new Date().toISOString().slice(0, 10)}.${extension}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setExportError(exportError.message);
    } finally {
      setExportBusy(false);
    }
  };

  const decryptExport = async () => {
    if (!decryptFile || !decryptPassword) return;
    setDecryptBusy(true);
    setDecryptError("");
    setDecryptMessage("");
    try {
      const payload = JSON.parse(await decryptFile.text());
      if (payload.format !== "church-analytics-encrypted-export" || payload.version !== 1) {
        throw new Error("This file is not an encrypted analytics export.");
      }
      const keyMaterial = await window.crypto.subtle.importKey("raw", new TextEncoder().encode(decryptPassword), "PBKDF2", false, ["deriveKey"]);
      const key = await window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: Uint8Array.from(atob(payload.salt), (char) => char.charCodeAt(0)), iterations: 100000, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"],
      );
      const ciphertext = Uint8Array.from(atob(payload.ciphertext), (char) => char.charCodeAt(0));
      const tag = Uint8Array.from(atob(payload.authTag), (char) => char.charCodeAt(0));
      const combined = new Uint8Array(ciphertext.length + tag.length);
      combined.set(ciphertext);
      combined.set(tag, ciphertext.length);
      const decrypted = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: Uint8Array.from(atob(payload.iv), (char) => char.charCodeAt(0)), tagLength: 128 },
        key,
        combined,
      );
      const content = new TextDecoder().decode(decrypted);
      const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = decryptFile.name.replace(/\.enc$/i, ".txt");
      anchor.click();
      URL.revokeObjectURL(url);
      setDecryptMessage("Export decrypted and downloaded.");
    } catch (decryptError) {
      setDecryptError(decryptError.message.includes("not an encrypted") ? decryptError.message : "Decryption failed. Check the password and the selected file.");
    } finally {
      setDecryptBusy(false);
    }
  };

  const educationOptions = [...new Set(sponsoredRows.map((row) => row.educationLevel).filter(Boolean))].sort();
  const gradeOptions = [...new Set(sponsoredRows.map((row) => row.gradeLevel).filter(Boolean))].sort();
  const riskFilterOptions = [["all", "All levels"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]];
  const sponsorshipStatusOptions = [["all", "Any status"], ["active", "Active"], ["on_hold", "On hold"], ["withdrawn", "Withdrawn"], ["completed", "Completed"], ["graduated", "Graduated"], ["deceased", "Deceased"], ["new", "New"]];
  return (
    <>
      <Title
        e="ANALYTICS / INSIGHTS"
        t="Understand participation."
        d="Live attendance trends, predictive risk, and sponsored-child analytics built from actual records. Risk scores are decision-support information and always require staff review."
      />
      {loadError && (
        <div className="alert alert-danger d-flex justify-content-between align-items-center" role="alert">
          <span>{loadError}</span>
          <button type="button" className="btn-close" aria-label="Dismiss error" onClick={() => setLoadError("")} />
        </div>
      )}

      <section className="surface analytics-section">
        <div className="analytics-section-heading">
          <div>
            <h2>Overview</h2>
            <p className="analytics-section-sub">Live statistics for the selected range and participant group.</p>
          </div>
          <div className="analytics-filters">
            <div className="analytics-filter-field">
              <label className="form-label" htmlFor="analytics-from">From</label>
              <input id="analytics-from" className="form-control" type="date" value={from} onChange={(event) => handleFromChange(event.target.value)} />
            </div>
            <div className="analytics-filter-field">
              <label className="form-label" htmlFor="analytics-to">To</label>
              <input id="analytics-to" className="form-control" type="date" value={to} onChange={(event) => handleToChange(event.target.value)} />
            </div>
            <div className="analytics-filter-field">
              <label className="form-label" htmlFor="analytics-type">Participant type</label>
              <select id="analytics-type" className="form-select" value={participantType} onChange={(event) => setParticipantType(event.target.value)}>
                <option value="all">All participants</option>
                <option value="sponsored_child">Sponsored children</option>
                <option value="goer">Church goers</option>
              </select>
            </div>
          </div>
        </div>
        <div className="analytics-stat-grid">
          <div className="analytics-stat-card">
            <span className="analytics-stat-label">Total participants</span>
            <strong className="analytics-stat-value">{overviewLoading ? "—" : (overview ? formatCount(overview.totalParticipants) : "0")}</strong>
            <span className="analytics-stat-sub">Active in the selected scope</span>
          </div>
          <div className="analytics-stat-card">
            <span className="analytics-stat-label">Attendance rate</span>
            <strong className="analytics-stat-value">{overviewLoading ? "—" : (overview ? `${Number(overview.attendanceRate) || 0}%` : "0%")}</strong>
            <span className="analytics-stat-sub">Unique participants who attended</span>
          </div>
          <div className="analytics-stat-card">
            <span className="analytics-stat-label">Recorded check-ins</span>
            <strong className="analytics-stat-value">{overviewLoading ? "—" : (overview ? formatCount(overview.totalCheckIns) : "0")}</strong>
            <span className="analytics-stat-sub">In the selected range</span>
          </div>
          <div className="analytics-stat-card analytics-stat-alert">
            <span className="analytics-stat-label">At-risk sponsored children</span>
            <strong className="analytics-stat-value">{overviewLoading ? "—" : (overview ? formatCount(overview.atRiskChildren) : "0")}</strong>
            <span className="analytics-stat-sub">Medium or high predictive risk</span>
          </div>
        </div>
        {overview && (
          <div className="analytics-split">
            <div className="analytics-split-item">
              <strong>{formatCount(overview?.sponsored?.checkIns)}</strong>
              <span>Sponsored-child check-ins ({formatCount(overview?.sponsored?.uniqueParticipants)} unique)</span>
            </div>
            <div className="analytics-split-item">
              <strong>{formatCount(overview?.goers?.checkIns)}</strong>
              <span>Church goer check-ins ({formatCount(overview?.goers?.uniqueParticipants)} unique)</span>
            </div>
          </div>
        )}
      </section>

      <section className="surface analytics-section">
        <div className="analytics-section-heading">
          <div>
            <h2>Attendance trends</h2>
            <p className="analytics-section-sub">Daily, weekly, monthly, and yearly attendance comparing sponsored children and church goers.</p>
          </div>
          <div className="analytics-filters">
            <div className="analytics-filter-field">
              <label className="form-label" htmlFor="analytics-interval">Interval</label>
              <select id="analytics-interval" className="form-select" value={trendInterval} onChange={(event) => setTrendInterval(event.target.value)}>
                <option value="day">Daily</option>
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
                <option value="year">Yearly</option>
              </select>
            </div>
            <div className="analytics-filter-field">
              <label className="form-label" htmlFor="analytics-event">Event</label>
              <select id="analytics-event" className="form-select" value={trendEvent} onChange={(event) => setTrendEvent(event.target.value)}>
                <option value="">All events</option>
                {trendEvents.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          </div>
        </div>
        {trendsLoading ? (
          <div className="analytics-empty">Loading attendance trends…</div>
        ) : trends.length === 0 ? (
          <div className="analytics-empty">No attendance records found for the selected filters.</div>
        ) : (
          <>
            <div className="analytics-trend-summary">
              <div><strong>{formatCount(trendTotals.totalCheckIns)}</strong><span>Total attendance</span></div>
              <div><strong>{overview ? formatCount(overview.uniqueParticipants) : "—"}</strong><span>Unique participants</span></div>
              <div><strong>{formatCount(trendTotals.sponsoredCheckIns)}</strong><span>Sponsored-child check-ins</span></div>
              <div><strong>{formatCount(trendTotals.goerCheckIns)}</strong><span>Church goer check-ins</span></div>
            </div>
            <div className="analytics-chart-wrap">
              <canvas ref={trendCanvas} />
            </div>
          </>
        )}
      </section>

      <section className="surface analytics-section">
        <div className="analytics-section-heading">
          <div>
            <h2>Predictive participation</h2>
            <p className="analytics-section-sub">Risk scores from attendance frequency, regularity, and recency. Decision-support only — never a sole basis for decisions about a child.</p>
          </div>
          <div className="analytics-filters">
            <div className="analytics-filter-field">
              <label className="form-label" htmlFor="analytics-risk-level">Risk level</label>
              <select id="analytics-risk-level" className="form-select" value={riskLevel} onChange={(event) => setRiskLevel(event.target.value)}>
                {riskFilterOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <button className="btn btn-dark" type="button" disabled={refreshing} onClick={refreshModel}>
              {refreshing ? "Evaluating history…" : "Evaluate and refresh scores"}
            </button>
          </div>
        </div>
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
          </div>
          {validation?.metrics && validation?.baseline && validation?.counts && (
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
        {riskLoading ? (
          <div className="analytics-empty">Loading risk scores…</div>
        ) : riskRows.length === 0 ? (
          <div className="analytics-empty">No predictive risk records found for the selected level. Evaluate and refresh scores to generate them.</div>
        ) : (
          <div className="analytics-table-wrap">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Participant</th>
                  <th>Type</th>
                  <th>Score</th>
                  <th>Level</th>
                  <th>Trend</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {riskRows.map((row) => (
                  <tr key={row.participantId}>
                    <td>
                      <strong>{row.participantCode}</strong>
                      {row.gradeLevel && <small>{row.gradeLevel}</small>}
                    </td>
                    <td>{row.participantType === "sponsored_child" ? "Sponsored child" : "Church goer"}</td>
                    <td><strong>{Number(row.riskScore).toFixed(0)}</strong></td>
                    <td><Badge level={row.riskLevel} /></td>
                    <td>
                      <span className={`trend-badge trend-${row.trend}`}>{row.trend === "unknown" ? "Unknown" : row.trend}</span>
                    </td>
                    <td>
                      {row.insufficientData ? (
                        <span className="insufficient-badge">Insufficient data</span>
                      ) : (
                        <span className="evidence-text" title={row.summary}>{row.summary}</span>
                      )}
                      {!row.insufficientData && (
                        <small className="evidence-meta">
                          {row.checkInsPerWeek}/week · {row.regularity}% regularity · last check-in {row.recencyDays}d ago · {row.modelVersion}
                        </small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canViewSponsorship && (
        <section className="surface analytics-section">
          <div className="analytics-section-heading">
            <div>
              <h2>Sponsored-child analytics</h2>
              <p className="analytics-section-sub">Participation trends and attendance summaries for each sponsored child, with education-year, grade-level, and sponsorship filters.</p>
            </div>
            <div className="analytics-filters">
              <div className="analytics-filter-field">
                <label className="form-label" htmlFor="sponsored-education">Education year</label>
                <select id="sponsored-education" className="form-select" value={sponsoredFilters.educationLevel} onChange={(event) => setSponsoredFilters({ ...sponsoredFilters, educationLevel: event.target.value })}>
                  <option value="">All education years</option>
                  {educationOptions.map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
              </div>
              <div className="analytics-filter-field">
                <label className="form-label" htmlFor="sponsored-grade">Grade level</label>
                <select id="sponsored-grade" className="form-select" value={sponsoredFilters.gradeLevel} onChange={(event) => setSponsoredFilters({ ...sponsoredFilters, gradeLevel: event.target.value })}>
                  <option value="">All grade levels</option>
                  {gradeOptions.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                </select>
              </div>
              <div className="analytics-filter-field">
                <label className="form-label" htmlFor="sponsored-status">Sponsorship status</label>
                <select id="sponsored-status" className="form-select" value={sponsoredFilters.sponsorshipStatus} onChange={(event) => setSponsoredFilters({ ...sponsoredFilters, sponsorshipStatus: event.target.value })}>
                  {sponsorshipStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className="analytics-filter-field">
                <label className="form-label" htmlFor="sponsored-risk">Risk level</label>
                <select id="sponsored-risk" className="form-select" value={sponsoredFilters.riskLevel} onChange={(event) => setSponsoredFilters({ ...sponsoredFilters, riskLevel: event.target.value })}>
                  {riskFilterOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
            </div>
          </div>
          {sponsoredLoading ? (
            <div className="analytics-empty">Loading sponsored-child analytics…</div>
          ) : sponsoredRows.length === 0 ? (
            <div className="analytics-empty">No sponsored children match the selected filters.</div>
          ) : (
            <div className="analytics-table-wrap">
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th>Child</th>
                    <th>Education</th>
                    <th>Grade</th>
                    <th>Sponsorship</th>
                    <th>Check-ins</th>
                    <th>Last attended</th>
                    <th>Risk</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {sponsoredRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.name}</strong>
                        <small>{row.participantCode}</small>
                      </td>
                      <td>{row.educationLevel || "—"}</td>
                      <td>{row.gradeLevel || "—"}</td>
                      <td><span className="status-pill">{row.sponsorshipLifecycle}</span></td>
                      <td>{formatCount(row.checkInCount)}</td>
                      <td>{row.lastCheckIn ? new Date(row.lastCheckIn).toLocaleDateString() : "Never"}</td>
                      <td>{row.riskScore === null ? <span className="insufficient-badge">Not scored</span> : <Badge level={row.riskLevel} />}</td>
                      <td>
                        <button className="btn btn-sm btn-outline-dark" type="button" onClick={() => openHistory(row.id)}>History</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {canExportReports && (
        <section className="surface analytics-section">
          <div className="analytics-section-heading">
            <div>
              <h2>Reports and export</h2>
              <p className="analytics-section-sub">Download attendance summaries, participation histories, at-risk lists, and the system audit trail. Exports respect role-based permissions and can be password-encrypted.</p>
            </div>
            <div className="analytics-filters">
              <div className="analytics-filter-field">
                <label className="form-label" htmlFor="report-type">Report</label>
                <select id="report-type" className="form-select" value={reportType} onChange={(event) => setReportType(event.target.value)}>
                  <option value="attendance">Attendance summary</option>
                  <option value="at-risk">At-risk participant list</option>
                  <option value="participant-history">Individual participation history</option>
                  {isSystemAdmin && <option value="audit-trail">System audit trail</option>}
                </select>
              </div>
              <div className="analytics-filter-field">
                <label className="form-label" htmlFor="report-format">Format</label>
                <select id="report-format" className="form-select" value={reportFormat} onChange={(event) => setReportFormat(event.target.value)}>
                  <option value="csv">CSV</option>
                  <option value="pdf">PDF</option>
                </select>
              </div>
              {reportType === "participant-history" && (
                <div className="analytics-filter-field">
                  <label className="form-label" htmlFor="report-participant">Participant</label>
                  {canViewSponsorship && sponsoredRows.length > 0 ? (
                    <select id="report-participant" className="form-select" value={exportParticipantId} onChange={(event) => setExportParticipantId(event.target.value)}>
                      <option value="">Select a child</option>
                      {sponsoredRows.map((row) => <option key={row.id} value={row.id}>{row.name} ({row.participantCode})</option>)}
                    </select>
                  ) : (
                    <input id="report-participant" className="form-control" type="number" min="1" value={exportParticipantId} onChange={(event) => setExportParticipantId(event.target.value)} placeholder="Participant ID" />
                  )}
                </div>
              )}
              <div className="analytics-filter-field">
                <label className="form-label" htmlFor="report-password">Password (optional)</label>
                <input id="report-password" className="form-control" type="password" value={reportPassword} onChange={(event) => setReportPassword(event.target.value)} placeholder="Encrypt the export" />
              </div>
              <div className="analytics-filter-field analytics-filter-action">
                <label className="form-label" aria-hidden="true">Download</label>
                <button className="btn btn-dark" type="button" disabled={exportBusy} onClick={downloadReport}>
                  {exportBusy ? "Preparing…" : `Download ${reportFormat.toUpperCase()}`}
                </button>
              </div>
            </div>
          </div>
          {exportError && <div className="alert alert-danger" role="alert">{exportError}</div>}
          <div className="analytics-export-note">
            {reportType === "attendance" && `Uses the selected range (${from} to ${to}), participant type, interval, and event filters.`}
            {reportType === "at-risk" && `Includes participant codes, risk scores, and supporting evidence for ${riskLevel === "all" ? "all risk levels" : `${riskLevel} risk`}.`}
            {reportType === "participant-history" && "Includes one participant's complete check-in history with names, events, locations, and check-out times."}
            {reportType === "audit-trail" && "System audit trail is restricted to System Administrators and includes the 5,000 most recent entries."}
            {reportPassword ? "This export will be encrypted with AES-256-GCM (PBKDF2-derived key) and downloaded as a .enc file." : "Leave the password blank to download an unencrypted file."}
          </div>
          <div className="analytics-decrypt">
            <div className="analytics-decrypt-copy">
              <h3>Decrypt an encrypted export</h3>
              <p>Choose a .enc file and enter the password used to encrypt it. The decrypted report downloads as a text file.</p>
            </div>
            <div className="analytics-decrypt-controls">
              <input className="form-control" type="file" accept=".enc,application/json" onChange={(event) => setDecryptFile(event.target.files?.[0] || null)} />
              <input className="form-control" type="password" value={decryptPassword} onChange={(event) => setDecryptPassword(event.target.value)} placeholder="Export password" />
              <button className="btn btn-outline-dark" type="button" disabled={decryptBusy || !decryptFile || !decryptPassword} onClick={decryptExport}>
                {decryptBusy ? "Decrypting…" : "Decrypt export"}
              </button>
            </div>
            {decryptError && <div className="alert alert-danger mt-2 mb-0" role="alert">{decryptError}</div>}
            {decryptMessage && <div className="alert alert-success mt-2 mb-0" role="status">{decryptMessage}</div>}
          </div>
        </section>
      )}

      {(history || historyLoading) && createPortal(
        <div className="participant-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setHistory(null);
            setHistoryLoading(false);
          }
        }}>
          <section className="participant-modal history-modal" role="dialog" aria-modal="true" aria-labelledby="history-title">
            <header className="participant-modal-header">
              <div>
                <span className="eyebrow">PARTICIPANT / ATTENDANCE HISTORY</span>
                <h2 id="history-title">{history ? history.participant.name : "Attendance history"}</h2>
                <p>{history ? `${history.participant.participantCode} · ${history.participant.participantType === "sponsored_child" ? "Sponsored child" : "Church goer"}${history.participant.gradeLevel ? ` · ${history.participant.gradeLevel}` : ""}` : "Loading attendance history…"}</p>
              </div>
              <button type="button" className="btn-close" aria-label="Close attendance history" onClick={() => { setHistory(null); setHistoryLoading(false); }} />
            </header>
            {historyLoading ? (
              <div className="analytics-empty">Loading attendance history…</div>
            ) : history && (
              <>
                <div className="analytics-trend-summary">
                  <div><strong>{formatCount(history?.summary?.totalCheckIns)}</strong><span>Total check-ins</span></div>
                  <div><strong>{formatCount(history?.summary?.uniqueEvents)}</strong><span>Unique events</span></div>
                  <div><strong>{history.summary.lastCheckIn ? new Date(history.summary.lastCheckIn).toLocaleDateString() : "—"}</strong><span>Last check-in</span></div>
                  <div><strong>{history.summary.firstCheckIn ? new Date(history.summary.firstCheckIn).toLocaleDateString() : "—"}</strong><span>First check-in</span></div>
                </div>
                <div className="analytics-table-wrap analytics-history-table">
                  <table className="analytics-table">
                    <thead>
                      <tr>
                        <th>Checked in</th>
                        <th>Event</th>
                        <th>Location</th>
                        <th>Checked out</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.attendance.map((row, index) => (
                        <tr key={`${row.checkedInAt}-${index}`}>
                          <td>{row.checkedInAt ? new Date(row.checkedInAt).toLocaleString() : "—"}</td>
                          <td>{row.eventName}</td>
                          <td>{row.location || "—"}</td>
                          <td>{row.checkedOutAt ? new Date(row.checkedOutAt).toLocaleString() : <span className="text-secondary">Not checked out</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </div>,
        document.body,
      )}
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
const formatCurrency = (value) => new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "PHP",
}).format(Number(value || 0));

function SponsoredCare({ user }) {
  const isGoer = String(user?.role || "").toLowerCase() === GOER_ROLE;
  const canManage = canAccessPermission("sponsorship:manage", user);
  const canRecordCare = canManage ||
    (isGoer && user?.permissions?.includes("goer-care:record"));
  const canViewUpdates = !isGoer && canAccessPermission("sponsorship:view", user);
  const [children, setChildren] = useState([]);
  const [letters, setLetters] = useState([]);
  const [sponsors, setSponsors] = useState([]);
  const [showCreateSponsor, setShowCreateSponsor] = useState(false);
  const [sponsorForm, setSponsorForm] = useState({ familyName: "", sex: "", sponsorType: "" });
  const [sponsorFormError, setSponsorFormError] = useState("");
  const [sponsorFieldErrors, setSponsorFieldErrors] = useState({});
  const [creatingSponsor, setCreatingSponsor] = useState(false);
  const [selectedChildId, setSelectedChildId] = useState(null);
  const disbursementRequestRef = useRef(null);
  const disbursementSubmissionRef = useRef(false);
  const [savingDisbursement, setSavingDisbursement] = useState(false);
  const [disbursements, setDisbursements] = useState([]);
  const [allowanceTransactions, setAllowanceTransactions] = useState([]);
  const [allowanceAmount, setAllowanceAmount] = useState("");
  const [allowanceAction, setAllowanceAction] = useState("add");
  const [childUpdates, setChildUpdates] = useState([]);
  const [staffProof, setStaffProof] = useState(null);
  const [query, setQuery] = useState("");
  const [gift, setGift] = useState({ careType: "allowance", amount: "", disbursedOn: new Date().toISOString().slice(0, 10), description: "", receiptData: "" });
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
  const [letterSubject, setLetterSubject] = useState("");
  const [letterMessage, setLetterMessage] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showChildModal, setShowChildModal] = useState(false);
  const [activeAction, setActiveAction] = useState(null);
  const [showAllowanceEditor, setShowAllowanceEditor] = useState(false);
  const [monthlyAllowanceDraft, setMonthlyAllowanceDraft] = useState("");
  const [savingAllowance, setSavingAllowance] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      apiCall("/sponsorship/children"),
      apiCall("/sponsorship/letters"),
      canManage ? apiCall("/sponsorship/sponsors") : Promise.resolve([]),
    ])
      .then(([childRows, letterRows, sponsorRows]) => {
        if (!mounted) return;
        setChildren(childRows);
        setLetters(letterRows);
        setSponsors(sponsorRows);
      })
      .catch((loadError) => {
        if (mounted) setError(loadError.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [canManage]);

  const createSponsor = async (event) => {
    event.preventDefault();
    setSponsorFieldErrors({});
    setSponsorFormError("");
    setError("");
    setCreatingSponsor(true);
    try {
      const { sponsor } = await apiCall("/sponsorship/sponsors", {
        method: "POST",
        body: JSON.stringify(sponsorForm),
      });
      setSponsors((current) => [sponsor, ...current]);
      setSponsorForm({ familyName: "", sex: "", sponsorType: "" });
      setShowCreateSponsor(false);
      setMessage("Sponsor created.");
    } catch (saveError) {
      setError(saveError.message);
      setSponsorFormError(saveError.message);
      setSponsorFieldErrors(saveError.errors || {});
    } finally {
      setCreatingSponsor(false);
    }
  };

  useEffect(() => {
    if (!showCreateSponsor) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !creatingSponsor) setShowCreateSponsor(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [creatingSponsor, showCreateSponsor]);

  const selectChild = async (child) => {
    setSelectedChildId(child.id);
    setShowChildModal(true);
    setActiveAction(null);
    setShowAllowanceEditor(false);
    setMonthlyAllowanceDraft(String(child.monthlyAllowance ?? 0));
    setDisbursements([]);
    setAllowanceTransactions([]);
    setChildUpdates([]);
    setStaffProof(null);
    setSelectedThreadId(null);
    setError("");
    try {
      const [records, updates, transactions] = await Promise.all([
        apiCall(`/sponsorship/children/${child.id}/disbursements`),
        canViewUpdates
          ? apiCall(`/sponsorship/children/${child.id}/updates`)
          : Promise.resolve([]),
        canViewUpdates
          ? apiCall(`/sponsorship/children/${child.id}/allowance-transactions`)
          : Promise.resolve([]),
      ]);
      setDisbursements(records);
      setChildUpdates(updates);
      setAllowanceTransactions(transactions);
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  const saveMonthlyAllowance = async (event) => {
    event.preventDefault();
    if (!selectedChildId) return;
    const amount = Number(monthlyAllowanceDraft);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) {
      setError("Monthly allowance must be between 0 and 1,000,000.");
      return;
    }
    setSavingAllowance(true);
    setError("");
    setMessage("");
    try {
      await apiCall(`/sponsorship/children/${selectedChildId}`, {
        method: "PUT",
        body: JSON.stringify({
          lifecycle: normalizeSponsorLifecycle(selectedChild?.lifecycle) || "active",
          monthlyAllowance: amount,
        }),
      });
      setChildren((current) => current.map((child) => (child.id === selectedChildId
        ? { ...child, monthlyAllowance: amount }
        : child)));
      setMessage(`Monthly allowance set to ${formatCurrency(amount)}.`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingAllowance(false);
    }
  };

  useEffect(() => {
    if (!showChildModal && !activeAction) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        if (activeAction) setActiveAction(null);
        else setShowChildModal(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showChildModal, activeAction]);

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
      setActiveAction(null);
      setMessage("Sponsored child update recorded.");
    } catch (saveError) {
      setError(saveError.message);
    }
  };

  const recordDisbursement = async (event) => {
    event.preventDefault();
    if (!selectedChildId) return;
    if (allowanceAction === "deduct" && !window.confirm("Confirm deducting this amount from the child’s available balance?")) return;
    if (disbursementSubmissionRef.current) return;
    disbursementSubmissionRef.current = true;
    setSavingDisbursement(true);
    setError("");
    setMessage("");
    try {
      let result;
      if (allowanceAction === "add") {
        result = await apiCall(`/sponsorship/children/${selectedChildId}/allowance-transactions`, {
          method: "POST",
          body: JSON.stringify({ type: "add", amount: allowanceAmount }),
        });
        setChildren((current) => current.map((child) => child.id === selectedChildId
          ? { ...child, availableBalance: result.transaction.updatedBalance }
          : child));
      } else {
        const requestFingerprint = JSON.stringify([
          selectedChildId,
          allowanceAmount,
          gift.disbursedOn,
          gift.receiptData,
        ]);
        let idempotencyKey;
        if (disbursementRequestRef.current?.fingerprint === requestFingerprint) {
          idempotencyKey = disbursementRequestRef.current.key;
        } else {
          idempotencyKey = window.crypto.randomUUID();
          disbursementRequestRef.current = { fingerprint: requestFingerprint, key: idempotencyKey };
        }
        result = await apiCall(`/sponsorship/children/${selectedChildId}/disbursements`, {
          method: "POST",
          body: JSON.stringify({ amount: allowanceAmount, disbursedOn: gift.disbursedOn, receiptData: gift.receiptData, idempotencyKey }),
        });
        setChildren((current) => current.map((child) => child.id === selectedChildId
          ? { ...child, availableBalance: result.updatedBalance }
          : child));
        setDisbursements(await apiCall(`/sponsorship/children/${selectedChildId}/disbursements`));
        disbursementRequestRef.current = null;
      }
      setAllowanceTransactions(await apiCall(`/sponsorship/children/${selectedChildId}/allowance-transactions`));
      setAllowanceAmount("");
      setAllowanceAction("add");
      setGift({ careType: "allowance", amount: "", disbursedOn: new Date().toISOString().slice(0, 10), description: "", receiptData: "" });
      setReceiptName("");
      setActiveAction(null);
      setMessage(allowanceAction === "add"
        ? `Allowance added. Updated balance: ${formatCurrency(result.transaction.updatedBalance)}.`
        : `Sponsorship disbursement of ${formatCurrency(result.amount)} recorded. Updated balance: ${formatCurrency(result.updatedBalance)}.`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      disbursementSubmissionRef.current = false;
      setSavingDisbursement(false);
    }
  };
  const reverseAllowanceTransaction = async (transaction) => {
    if (!window.confirm("Create a reversal transaction? The original transaction will remain in the audit history.")) return;
    setError("");
    setMessage("");
    try {
      const result = await apiCall(
        `/sponsorship/children/${selectedChildId}/allowance-transactions/${transaction.id}/reverse`,
        { method: "POST" },
      );
      setChildren((current) => current.map((child) => child.id === selectedChildId
        ? { ...child, availableBalance: result.transaction.updatedBalance }
        : child));
      setAllowanceTransactions(await apiCall(`/sponsorship/children/${selectedChildId}/allowance-transactions`));
      setMessage(`Reversal recorded. Updated balance: ${formatCurrency(result.transaction.updatedBalance)}.`);
    } catch (saveError) {
      setError(saveError.message);
    }
  };

  const openStaffReceipt = async (id) => {
    try {
      const proof = await apiCall(`/sponsorship/disbursements/${id}/receipt`, {
        method: "POST",
      });
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
      setActiveAction(null);
      setMessage(isGoer ? "Reply sent to the sponsor." : "Reply sent to the guardian.");
    } catch (replyError) {
      setError(replyError.message);
    }
  };
  const sendGoerLetter = async (event) => {
    event.preventDefault();
    if (!selectedChildId) return;
    setError("");
    setMessage("");
    try {
      const result = await apiCall(`/sponsorship/children/${selectedChildId}/letters`, {
        method: "POST",
        body: JSON.stringify({ subject: letterSubject, message: letterMessage }),
      });
      setLetterSubject("");
      setLetterMessage("");
      await refreshLetters();
      setSelectedThreadId(result.threadId);
      setActiveAction(null);
      setMessage("Letter sent to the sponsor.");
    } catch (letterError) {
      setError(letterError.message);
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
    `${child.name} ${child.participantCode}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selectedChild = children.find((child) => child.id === selectedChildId);
  const selectedThread = letters.find((thread) =>
    Number(thread.id) === Number(selectedThreadId) &&
    Number(thread.participantId) === Number(selectedChildId),
  );
  const selectedChildInitials = selectedChild?.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <>
      <section className={`sponsorship-page-hero${isGoer ? " goer" : ""}`}>
        <div className="sponsorship-page-hero-copy">
          <span className="sponsorship-page-eyebrow"><span aria-hidden="true">✦</span> {isGoer ? "YOUR CARE GROUP" : "CHILDREN · CARE · CONNECTION"}</span>
          <h1>{isGoer ? "Care starts with you." : "Every child, moving forward."}</h1>
          <p>{isGoer
            ? `Keep care moving for the ${user.goerEducationLevel} group. Record what children receive and stay connected with their sponsors.`
            : "A clearer view of every sponsorship journey—from school details and allowances to the little moments that matter."}</p>
        </div>
        <div className="sponsorship-hero-art" aria-hidden="true">
          <span className="sponsorship-hero-orbit sponsorship-hero-orbit-one" />
          <span className="sponsorship-hero-orbit sponsorship-hero-orbit-two" />
          <span className="sponsorship-hero-heart">♡</span>
          <span className="sponsorship-hero-note">{children.length}<small>{isGoer ? "children in your group" : "children in care"}</small></span>
        </div>
      </section>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}
      {canManage && (
        <section className="surface sponsorship-directory-panel">
          <div className="sponsorship-list-heading">
            <div>
              <span className="sponsorship-section-eyebrow">SPONSOR DIRECTORY</span>
              <h2>Sponsors</h2>
            </div>
            <button type="button" className="btn btn-dark" onClick={() => {
              setError("");
              setSponsorFormError("");
              setSponsorFieldErrors({});
              setShowCreateSponsor(true);
            }}>+ Create sponsor</button>
          </div>
          {sponsors.length ? (
            <div className="sponsorship-sponsor-list">
              {sponsors.map((sponsor) => (
                <article className="sponsorship-sponsor-card" key={sponsor.id}>
                  <span className="sponsorship-child-avatar" aria-hidden="true">
                    {sponsor.familyName.trim().slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{sponsor.familyName}</strong>
                    <small>{sponsor.sponsorType} · {sponsor.sex}</small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-secondary mb-0">No sponsors have been created yet.</p>
          )}
        </section>
      )}
      {showCreateSponsor && createPortal((
        <div className="participant-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !creatingSponsor) setShowCreateSponsor(false);
        }}>
          <section className="participant-modal sponsor-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-sponsor-title">
            <header className="participant-modal-header">
              <div>
                <span className="eyebrow">SPONSOR DIRECTORY / NEW RECORD</span>
                <h2 id="create-sponsor-title">Create a sponsor</h2>
                <p>Add a sponsor profile to the care directory.</p>
              </div>
              <button type="button" className="btn-close" aria-label="Close sponsor form" disabled={creatingSponsor} onClick={() => setShowCreateSponsor(false)} />
            </header>
            <form className="sponsor-create-form" onSubmit={createSponsor}>
              {sponsorFormError && <div className="alert alert-danger mb-0" role="alert">{sponsorFormError}</div>}
              <div>
                <label className="form-label" htmlFor="sponsor-family-name">Family name <span aria-hidden="true">*</span></label>
                <input
                  id="sponsor-family-name"
                  className={`form-control${sponsorFieldErrors.familyName ? " is-invalid" : ""}`}
                  value={sponsorForm.familyName}
                  onChange={(event) => setSponsorForm((current) => ({ ...current, familyName: event.target.value }))}
                  maxLength={100}
                  required
                  aria-invalid={sponsorFieldErrors.familyName ? "true" : undefined}
                />
                {sponsorFieldErrors.familyName && <div className="invalid-feedback d-block">{sponsorFieldErrors.familyName}</div>}
              </div>
              <div>
                <label className="form-label" htmlFor="sponsor-sex">Sex <span aria-hidden="true">*</span></label>
                <select
                  id="sponsor-sex"
                  className={`form-select${sponsorFieldErrors.sex ? " is-invalid" : ""}`}
                  value={sponsorForm.sex}
                  onChange={(event) => setSponsorForm((current) => ({ ...current, sex: event.target.value }))}
                  required
                  aria-invalid={sponsorFieldErrors.sex ? "true" : undefined}
                >
                  <option value="">Select sex</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
                {sponsorFieldErrors.sex && <div className="invalid-feedback d-block">{sponsorFieldErrors.sex}</div>}
              </div>
              <div>
                <label className="form-label" htmlFor="sponsor-type">Type of sponsor <span aria-hidden="true">*</span></label>
                <select
                  id="sponsor-type"
                  className={`form-select${sponsorFieldErrors.sponsorType ? " is-invalid" : ""}`}
                  value={sponsorForm.sponsorType}
                  onChange={(event) => setSponsorForm((current) => ({ ...current, sponsorType: event.target.value }))}
                  required
                  aria-invalid={sponsorFieldErrors.sponsorType ? "true" : undefined}
                >
                  <option value="">Select sponsor type</option>
                  <option value="Individual">Individual</option>
                  <option value="Family">Family</option>
                  <option value="Couple">Couple</option>
                </select>
                {sponsorFieldErrors.sponsorType && <div className="invalid-feedback d-block">{sponsorFieldErrors.sponsorType}</div>}
              </div>
              <footer className="sponsor-create-footer">
                <button type="button" className="btn btn-outline-secondary" disabled={creatingSponsor} onClick={() => setShowCreateSponsor(false)}>Cancel</button>
                <button type="submit" className="btn btn-dark" disabled={creatingSponsor}>{creatingSponsor ? "Creating…" : "Create sponsor"}</button>
              </footer>
            </form>
          </section>
        </div>
      ), document.body)}
      <div className="sponsorship-workspace">
        <section className="surface sponsorship-child-list">
          <div className="sponsorship-list-heading">
            <div><span className="sponsorship-section-eyebrow">{isGoer ? "YOUR ROSTER" : "CARE DIRECTORY"}</span><h2>Children</h2></div>
            <span className="sponsorship-list-count">{visibleChildren.length} <small>shown</small></span>
          </div>
          <div className="sponsorship-search-wrap">
            <span aria-hidden="true">⌕</span>
            <input className="form-control" aria-label="Search sponsored children" placeholder="Find a child by name or ID" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          {loading ? <div className="sponsorship-loading" role="status"><span /> Loading your children...</div> : visibleChildren.map((child) => (
            <button className={`sponsorship-child-row ${Number(selectedChildId) === Number(child.id) ? "selected" : ""}`} key={child.id} onClick={() => selectChild(child)}>
              <span className="sponsorship-child-avatar" aria-hidden="true">{child.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
              <span className="sponsorship-child-copy"><strong>{child.name}</strong><small>{child.participantCode || `Child #${child.id}`}</small></span>
              <span className="sponsorship-child-arrow" aria-hidden="true">›</span>
            </button>
          ))}
          {!loading && !visibleChildren.length && <div className="sponsorship-no-results"><span aria-hidden="true">⌕</span><strong>No children found</strong><p>Try a different name search.</p></div>}
        </section>
      </div>
      {showChildModal && selectedChild && createPortal((
        <div className="participant-modal-backdrop child-profile-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !activeAction) setShowChildModal(false);
        }}>
          <section className="participant-modal child-profile-modal" role="dialog" aria-modal="true" aria-labelledby="child-profile-title">
            <header className="participant-modal-header">
              <div className="sponsorship-profile-summary">
                <span className="sponsorship-profile-avatar">{selectedChildInitials}</span>
                <div>
                  <span className="sponsorship-section-eyebrow">{selectedChild.participantCode || `CHILD #${selectedChild.id}`}</span>
                  <h2 id="child-profile-title">{selectedChild.name}</h2>
                  <span className="sponsorship-profile-caption">{isGoer ? `Care group · ${user.goerEducationLevel}` : "Growing with a community behind them"}</span>
                </div>
              </div>
              <button type="button" className="btn-close" aria-label="Close child profile" onClick={() => (activeAction ? setActiveAction(null) : setShowChildModal(false))} />
            </header>
            {!isGoer && (
              <div className="child-profile-stats">
                <div className="child-profile-stat">
                  <small>Available balance</small>
                  <strong>{formatCurrency(selectedChild.availableBalance)}</strong>
                </div>
                <div className="child-profile-stat">
                  <small>Monthly allowance</small>
                  <strong>{formatCurrency(selectedChild.monthlyAllowance)}</strong>
                </div>
                <div className="child-profile-stat">
                  <small>Child status</small>
                  <strong>{sponsorLifecycleLabel(selectedChild.lifecycle)}</strong>
                </div>
              </div>
            )}
            {canManage && (
              <div className="child-allowance-set">
                {showAllowanceEditor ? (
                  <form className="child-allowance-form" onSubmit={saveMonthlyAllowance}>
                    <div className="child-allowance-field">
                      <label className="form-label" htmlFor="child-monthly-allowance">Monthly allowance (PHP)</label>
                      <input id="child-monthly-allowance" className="form-control" type="number" min="0" max="1000000" step="0.01" required autoFocus value={monthlyAllowanceDraft} onChange={(event) => setMonthlyAllowanceDraft(event.target.value)} />
                    </div>
                    <div className="child-allowance-actions">
                      <button className="btn child-allowance-save" type="submit" disabled={savingAllowance}>{savingAllowance ? "Saving…" : "Save allowance"}</button>
                      <button className="btn btn-outline-secondary" type="button" onClick={() => setShowAllowanceEditor(false)}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <button type="button" className="btn child-allowance-toggle" onClick={() => {
                    setMonthlyAllowanceDraft(String(selectedChild.monthlyAllowance ?? 0));
                    setShowAllowanceEditor(true);
                  }}>
                    <span aria-hidden="true">₱</span> Set monthly allowance
                  </button>
                )}
              </div>
            )}
            {!isGoer && (
              <div className="sponsorship-school-readonly child-school">
                <p><strong>School name:</strong> {selectedChild.schoolName || "Not provided"}</p>
                <p><strong>School address:</strong> {selectedChild.schoolAddress || "Not provided"}</p>
              </div>
            )}
            <div className="child-action-grid">
              {canManage && (
                <button type="button" className="child-action-card card-growth" onClick={() => setActiveAction("growth")}>
                  <span className="action-icon" aria-hidden="true">✦</span>
                  <strong>Growth &amp; activity</strong>
                  <small>Record growth measurements, activities attended, and care notes.</small>
                </button>
              )}
              {canManage && (
                <button type="button" className="child-action-card card-disbursement" onClick={() => setActiveAction("disbursement")}>
                  <span className="action-icon" aria-hidden="true">₱</span>
                  <strong>Disbursement</strong>
                  <small>Add to or deduct from the child's available balance.</small>
                </button>
              )}
              {canRecordCare && (
                <button type="button" className="child-action-card card-letter" onClick={() => setActiveAction("letter")}>
                  <span className="action-icon" aria-hidden="true">✉</span>
                  <strong>Letter</strong>
                  <small>{isGoer ? "Write a new letter to the sponsor." : "Reply to the sponsor’s letter thread."}</small>
                </button>
              )}
            </div>
            <div className="child-modal-history">
              {canViewUpdates && (
                <div className="sponsorship-detail-section">
                  <div className="sponsorship-list-heading">
                    <div>
                      <h3>Growth and activity history</h3>
                      <span>Private notes and physical measurements are encrypted at rest.</span>
                    </div>
                    <span>{childUpdates.length} updates</span>
                  </div>
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
                </div>
              )}
              {!isGoer && (
                <div className="sponsorship-detail-section">
                  <h3>Available sponsorship allowance</h3>
                  <div className="allowance-balance-card">
                    <span>Available balance</span>
                    <strong>{formatCurrency(selectedChild.availableBalance)}</strong>
                  </div>
                  <h4 className="sponsorship-subheading">Allowance transaction history</h4>
                  <div className="table-responsive">
                    <table className="table align-middle">
                      <thead><tr><th>Date</th><th>Transaction ID</th><th>Transaction</th><th>Amount</th><th>Previous balance</th><th>Balance after</th><th>Recorded by</th><th /></tr></thead>
                      <tbody>{allowanceTransactions.map((transaction) => (
                        <tr key={transaction.id}>
                          <td>{new Date(transaction.createdAt).toLocaleString()}</td>
                          <td>{transaction.id}</td>
                          <td>{transaction.type === "reversal" ? "Reversal" : transaction.type === "add" ? "Addition" : transaction.disbursementId ? `Disbursement #${transaction.disbursementId}` : "Deduction"}</td>
                          <td>{formatCurrency(transaction.amount)}</td>
                          <td>{formatCurrency(transaction.previousBalance)}</td>
                          <td>{formatCurrency(transaction.updatedBalance)}</td>
                          <td>{transaction.createdByName || (transaction.createdBy ? `Staff #${transaction.createdBy}` : "System")}{transaction.createdByRole ? ` · ${transaction.createdByRole}` : ""}</td>
                          <td>{canManage && transaction.type !== "reversal" && !transaction.relatedTransactionId && (
                            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => reverseAllowanceTransaction(transaction)}>Reverse</button>
                          )}</td>
                        </tr>
                      ))}{!allowanceTransactions.length && <tr><td colSpan="8" className="text-secondary">No balance transactions recorded.</td></tr>}</tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="sponsorship-detail-section">
                <h4 className="sponsorship-subheading">{isGoer ? "Received allowance and gifts" : "Sponsorship disbursements"}</h4>
                <div className="table-responsive mt-3">
                  <table className="table align-middle">
                    <thead><tr><th>Date</th><th>Record</th><th>Amount</th><th>Note</th><th>Proof</th></tr></thead>
                    <tbody>{disbursements.map((record) => (
                      <tr key={record.id}><td>{new Date(record.recorded_on).toLocaleDateString()}</td><td>{record.recordType === "received" ? `${record.care_type[0].toUpperCase()}${record.care_type.slice(1)} received` : "Sponsor disbursement"}</td><td>{formatCurrency(record.amount)}</td><td>{record.recordType === "received" ? record.description || "—" : "—"}</td>                      <td>{record.hasReceipt ? (isGoer ? "Receipt on file" : <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => openStaffReceipt(String(record.id).replace(/^disbursement-/, ""))}>View proof</button>) : "—"}</td></tr>
                    ))}{!disbursements.length && <tr><td colSpan="5" className="text-secondary">No allowance or gift records.</td></tr>}</tbody>
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
              </div>
            </div>
            <div className="child-history-strip" role="status">
              {!isGoer && <span>{childUpdates.length} growth updates</span>}
              {!isGoer && <span>{allowanceTransactions.length} balance transactions</span>}
              <span>{disbursements.length} {isGoer ? "care records" : "disbursements"}</span>
              <span>{letters.filter((thread) => Number(thread.participantId) === Number(selectedChild.id)).length} letters</span>
            </div>
          </section>
        </div>
      ), document.body)}
      {activeAction === "growth" && canManage && createPortal((
        <div className="participant-modal-backdrop action-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setActiveAction(null);
        }}>
          <section className="participant-modal action-modal" role="dialog" aria-modal="true" aria-labelledby="growth-action-title">
            <header className="participant-modal-header">
              <div>
                <span className="eyebrow">CARE ACTIONS / GROWTH</span>
                <h2 id="growth-action-title">Growth &amp; activity</h2>
                <p>Record a measurement, activity, or care note for {selectedChild.name}.</p>
              </div>
              <button type="button" className="btn-close" aria-label="Close growth form" onClick={() => setActiveAction(null)} />
            </header>
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
          </section>
        </div>
      ), document.body)}
      {activeAction === "disbursement" && canManage && createPortal((
        <div className="participant-modal-backdrop action-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setActiveAction(null);
        }}>
          <section className="participant-modal action-modal" role="dialog" aria-modal="true" aria-labelledby="disbursement-action-title">
            <header className="participant-modal-header">
              <div>
                <span className="eyebrow">CARE ACTIONS / DISBURSEMENT</span>
                <h2 id="disbursement-action-title">Disbursement</h2>
                <p>Add to or deduct from {selectedChild.name}'s available balance. Deductions require a receipt or proof.</p>
              </div>
              <button type="button" className="btn-close" aria-label="Close disbursement form" onClick={() => setActiveAction(null)} />
            </header>
            <form className="sponsorship-gift-form" onSubmit={recordDisbursement}>
              <div><label className="form-label" htmlFor="disbursement-type">Transaction</label><select id="disbursement-type" className="form-select" value={allowanceAction} onChange={(event) => setAllowanceAction(event.target.value)}><option value="add">Add to balance</option><option value="deduct">Deduct from balance</option></select></div>
              <div><label className="form-label" htmlFor="disbursement-amount">Amount (PHP)</label><input id="disbursement-amount" className="form-control" type="number" min="0.01" max="1000000" step="0.01" required value={allowanceAmount} onChange={(event) => setAllowanceAmount(event.target.value)} /></div>
              {allowanceAction === "deduct" && <div><label className="form-label" htmlFor="disbursement-date">Date</label><input id="disbursement-date" className="form-control" type="date" required value={gift.disbursedOn} onChange={(event) => setGift({ ...gift, disbursedOn: event.target.value })} /></div>}
              {allowanceAction === "deduct" && <div className="sponsorship-gift-description"><label className="form-label" htmlFor="disbursement-receipt">Receipt proof (JPG, PNG, PDF; max 4 MB)</label><input id="disbursement-receipt" className="form-control" type="file" accept="image/jpeg,image/png,application/pdf" required onChange={(event) => {
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
              }} />{receiptName && <small className="text-secondary">{receiptName}</small>}</div>}
              <button className="btn btn-outline-dark" type="submit" disabled={(allowanceAction === "deduct" && !gift.receiptData) || savingDisbursement}>{savingDisbursement ? "Saving…" : allowanceAction === "add" ? "Add to balance" : "Record disbursement"}</button>
            </form>
            <p className="text-secondary">Current available balance: {formatCurrency(selectedChild.availableBalance)}. Deductions require a receipt or proof before they are recorded.</p>
          </section>
        </div>
      ), document.body)}
      {activeAction === "letter" && canRecordCare && createPortal((
        <div className="participant-modal-backdrop action-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setActiveAction(null);
        }}>
          <section className="participant-modal action-modal action-modal-letter" role="dialog" aria-modal="true" aria-labelledby="letter-action-title">
            <header className="participant-modal-header">
              <div>
                <span className="eyebrow">CARE ACTIONS / LETTERS</span>
                <h2 id="letter-action-title">Letters</h2>
                <p>{isGoer ? `Write to the sponsor of ${selectedChild.name}.` : `Reply to the sponsor of ${selectedChild.name}.`}</p>
              </div>
              <button type="button" className="btn-close" aria-label="Close letters" onClick={() => setActiveAction(null)} />
            </header>
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
                  {canRecordCare && selectedThread.status !== "closed" && <form onSubmit={sendStaffReply}><label className="visually-hidden" htmlFor="staff-letter-reply">Reply to sponsor</label><textarea id="staff-letter-reply" className="form-control mb-2" rows="3" maxLength={5000} required value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write a reply to the sponsor" /><button className="btn btn-sm btn-dark">Send reply</button></form>}
                </div>
              )}
              {isGoer && (!selectedThread || selectedThread.status === "closed") && (
                <form className="guardian-letter-form" onSubmit={sendGoerLetter}>
                  <div>
                    <label className="form-label" htmlFor="goer-letter-subject">Subject</label>
                    <input id="goer-letter-subject" className="form-control" maxLength={160} required value={letterSubject} onChange={(event) => setLetterSubject(event.target.value)} placeholder="A short subject for the sponsor" />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="goer-letter-message">Letter to sponsor</label>
                    <textarea id="goer-letter-message" className="form-control" rows="5" maxLength={5000} required value={letterMessage} onChange={(event) => setLetterMessage(event.target.value)} placeholder="Write an update or message to the sponsor" />
                  </div>
                  <button className="btn btn-dark" type="submit">Send letter</button>
                </form>
              )}
            </div>
          </section>
        </div>
      ), document.body)}
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
  const [goers, setGoers] = useState([]);
  const [goerGroups, setGoerGroups] = useState({});
  const [goerForm, setGoerForm] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    email: "",
    password: "",
    educationLevel: EDUCATION_LEVELS[0],
  });
  const [permissionsById, setPermissionsById] = useState({});
  const [form, setForm] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    email: "",
    password: "",
  });
  const [newPermissions, setNewPermissions] = useState([]);
  const [registrationType, setRegistrationType] = useState(null);
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
    if (!registrationType) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !saving) {
        setRegistrationType(null);
        setError("");
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [registrationType, saving]);

  useEffect(() => {
    let mounted = true;
    Promise.all([apiCall("/staff"), apiCall("/goers")])
      .then(([staffResult, goerResult]) => {
        if (!mounted) return;
        setStaff(staffResult.staff);
        setPermissionsById(Object.fromEntries(
          staffResult.staff.map((account) => [account.id, account.permissions]),
        ));
        setGoers(goerResult.goers);
        setGoerGroups(Object.fromEntries(
          goerResult.goers.map((account) => [account.id, account.goerEducationLevel]),
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
      const result = await apiCall("/staff", {
        method: "POST",
        body: JSON.stringify({ ...form, permissions: newPermissions }),
      });
      setForm({ firstName: "", middleName: "", lastName: "", email: "", password: "" });
      setNewPermissions([]);
      setMessage("Church Administrator account created.");
      setStaff((previous) => [...previous, result.staff].sort((left, right) =>
        left.fullName.localeCompare(right.fullName),
      ));
      setPermissionsById((previous) => ({
        ...previous,
        [result.staff.id]: result.staff.permissions,
      }));
      setRegistrationType(null);
    } catch (createError) {
      setError(createError.message);
    } finally {
      setSaving(false);
    }
  };

  const createGoer = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await apiCall("/goers", {
        method: "POST",
        body: JSON.stringify(goerForm),
      });
      setGoers((previous) => [...previous, result.goer].sort((left, right) =>
        left.fullName.localeCompare(right.fullName),
      ));
      setGoerGroups((previous) => ({
        ...previous,
        [result.goer.id]: result.goer.goerEducationLevel,
      }));
      setGoerForm({
        firstName: "",
        middleName: "",
        lastName: "",
        email: "",
        password: "",
        educationLevel: EDUCATION_LEVELS[0],
      });
      setMessage(`${result.goer.goerEducationLevel} Goer account created.`);
      setRegistrationType(null);
    } catch (createError) {
      setError(createError.message);
    } finally {
      setSaving(false);
    }
  };

  const saveGoerGroup = async (account) => {
    const educationLevel = goerGroups[account.id];
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await apiCall(`/goers/${account.id}/group`, {
        method: "PUT",
        body: JSON.stringify({ educationLevel }),
      });
      setGoers((previous) => previous.map((item) =>
        item.id === account.id ? { ...item, goerEducationLevel: result.educationLevel } : item,
      ));
      setMessage(`${account.fullName} is assigned to ${result.educationLevel}.`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleGoerStatus = async (account) => {
    const status = account.status === "active" ? "inactive" : "active";
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await apiCall(`/goers/${account.id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      setGoers((previous) => previous.map((item) =>
        item.id === account.id ? { ...item, status } : item,
      ));
      setMessage(`${account.fullName} is now ${status}.`);
    } catch (statusError) {
      setError(statusError.message);
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
      setMessage(`Permissions saved for ${account.fullName}.`);
      setPermissionEditor(null);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const openRegistrationModal = (type) => {
    setError("");
    setRegistrationType(type);
  };
  const closeRegistrationModal = () => {
    if (saving) return;
    setRegistrationType(null);
    setError("");
  };
  const registrationForm = registrationType === "goer" ? goerForm : form;
  const setRegistrationField = (field, value) => {
    const updateForm = registrationType === "goer" ? setGoerForm : setForm;
    updateForm((previous) => ({ ...previous, [field]: value }));
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
      setMessage(`${account.fullName} is now ${status}.`);
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
        t="Manage accounts."
        d="Create permission-based Church Administrator accounts or attendance-only Goer accounts assigned to one education group."
      />
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}
      <section className="surface form-surface staff-create-panel">
        <div className="panel-title"><h2>Register account</h2></div>
        <p className="text-secondary">Choose the account type to open its registration form.</p>
        <div className="d-flex flex-wrap gap-2">
          <button className="btn btn-dark" type="button" onClick={() => openRegistrationModal("staff")}>Register Church Administrator</button>
          <button className="btn btn-outline-primary" type="button" onClick={() => openRegistrationModal("goer")}>Register Goer</button>
        </div>
      </section>
      <section className="surface table-surface staff-list-panel">
        <div className="panel-title"><h2>Goer accounts</h2><span>{goers.length} accounts</span></div>
        {loading ? <p role="status">Loading Goer accounts...</p> : goers.length ? (
          <div className="staff-account-list">
            {goers.map((account) => (
              <article className="staff-account-card" key={account.id}>
                <div className="staff-account-heading">
                  <div><h3>{account.fullName}</h3><p>{account.email} · Goer</p></div>
                  <span className={`staff-account-status ${account.status}`}>{account.status}</span>
                </div>
                <div className="row g-2 align-items-end">
                  <div className="col-12 col-sm-7">
                    <label className="form-label" htmlFor={`goer-group-${account.id}`}>Assigned group</label>
                    <select
                      id={`goer-group-${account.id}`}
                      className="form-select"
                      value={goerGroups[account.id] || ""}
                      onChange={(event) => setGoerGroups((previous) => ({
                        ...previous,
                        [account.id]: event.target.value,
                      }))}
                    >
                      <option value="" disabled>Select education group</option>
                      {EDUCATION_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                    </select>
                  </div>
                  <div className="col-12 col-sm-auto">
                    <button
                      className="btn btn-outline-primary btn-sm"
                      type="button"
                      disabled={saving || goerGroups[account.id] === account.goerEducationLevel}
                      onClick={() => saveGoerGroup(account)}
                    >
                      Save group
                    </button>
                  </div>
                </div>
                <div className="staff-account-actions">
                  <button className={`btn btn-sm ${account.status === "active" ? "btn-outline-danger" : "btn-outline-success"}`} disabled={saving} onClick={() => toggleGoerStatus(account)}>
                    {account.status === "active" ? "Deactivate account" : "Activate account"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : <p className="text-secondary">No Goer accounts are registered.</p>}
      </section>
      <section className="surface table-surface staff-list-panel">
        <div className="panel-title"><h2>Church Administrator accounts</h2><span>{staff.length} accounts</span></div>
        {loading ? <p role="status">Loading staff accounts...</p> : staff.length ? (
          <div className="staff-account-list">
            {staff.map((account) => (
              <article className="staff-account-card" key={account.id}>
                <div className="staff-account-heading">
                  <div>
                    <h3>{account.fullName}</h3>
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
      {registrationType && createPortal(
        <div
          className="staff-permission-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeRegistrationModal();
          }}
        >
          <section
            className="staff-permission-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-registration-title"
          >
            <header className="staff-permission-modal-header">
              <div>
                <span className="eyebrow">NEW ACCOUNT</span>
                <h2 id="account-registration-title">
                  Register {registrationType === "goer" ? "Goer" : "Church Administrator"}
                </h2>
                <p>
                  {registrationType === "goer"
                    ? "Goer accounts can record attendance only for their assigned education group."
                    : "Choose the pages and actions this Church Administrator can access."}
                </p>
              </div>
              <button
                type="button"
                className="btn-close"
                aria-label="Close registration"
                disabled={saving}
                onClick={closeRegistrationModal}
              />
            </header>
            {error && <div className="alert alert-danger" role="alert">{error}</div>}
            <form
              className="vstack gap-3"
              onSubmit={registrationType === "goer" ? createGoer : createStaff}
            >
              <div className="row g-3">
                <div className="col-12 col-md-4">
                  <label className="form-label" htmlFor="register-first-name">First name</label>
                  <input id="register-first-name" className="form-control" autoComplete="given-name" maxLength={100} required value={registrationForm.firstName} onChange={(event) => setRegistrationField("firstName", event.target.value)} />
                </div>
                <div className="col-12 col-md-4">
                  <label className="form-label" htmlFor="register-middle-name">Middle name</label>
                  <input id="register-middle-name" className="form-control" autoComplete="additional-name" maxLength={100} value={registrationForm.middleName} onChange={(event) => setRegistrationField("middleName", event.target.value)} />
                </div>
                <div className="col-12 col-md-4">
                  <label className="form-label" htmlFor="register-last-name">Last name</label>
                  <input id="register-last-name" className="form-control" autoComplete="family-name" maxLength={100} required value={registrationForm.lastName} onChange={(event) => setRegistrationField("lastName", event.target.value)} />
                </div>
                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="register-email">Email address (login)</label>
                  <input id="register-email" className="form-control" type="email" autoComplete="email" maxLength={150} required value={registrationForm.email} onChange={(event) => setRegistrationField("email", event.target.value)} />
                </div>
                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="register-password">Temporary password</label>
                  <input id="register-password" className="form-control" type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={registrationForm.password} onChange={(event) => setRegistrationField("password", event.target.value)} />
                  <small className="text-secondary">At least 8 characters; give it to the staff member securely.</small>
                </div>
              </div>
              {registrationType === "goer" ? (
                <div>
                  <label className="form-label" htmlFor="register-education-level">Assigned education group</label>
                  <select
                    id="register-education-level"
                    className="form-select"
                    value={goerForm.educationLevel}
                    onChange={(event) => setGoerForm({ ...goerForm, educationLevel: event.target.value })}
                  >
                    {EDUCATION_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <div className="staff-create-permissions">
                    <div><strong>Account access</strong><small>{newPermissions.length} permission{newPermissions.length === 1 ? "" : "s"} selected</small></div>
                  </div>
                  <PermissionCheckboxes
                    idPrefix="new-staff-modal"
                    selected={newPermissions}
                    onChange={setNewPermissions}
                  />
                </div>
              )}
              <footer className="staff-permission-modal-footer">
                <button type="button" className="btn btn-outline-secondary" disabled={saving} onClick={closeRegistrationModal}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? "Saving…" : registrationType === "goer" ? "Create Goer account" : "Create staff account"}
                </button>
              </footer>
            </form>
          </section>
        </div>,
        document.body,
      )}
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
                  Permissions for {permissionEditor.account.fullName}
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
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={() => savePermissions(permissionEditor.account, permissionDraft)}
              >
                {saving ? "Saving…" : "Save permissions"}
              </button>
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
    scanner: <Scanner user={user} />,
    portal: <Scanner portal />,
    sponsorship: <SponsoredCare user={user} />,
    analytics: <Analytics user={user} />,
    reports: <Reports user={user} />,
  };
  if (canAccessPage("account", user)) {
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
