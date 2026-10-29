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
  { key: "dashboard:view", label: "Dashboard", description: "View your role-based dashboard." },
  { key: "participants:view", label: "View participants", description: "Allows staff to view participant information." },
  { key: "participants:edit", label: "Edit participants", description: "Allows staff to modify existing participant information." },
  { key: "participants:delete", label: "Delete participants", description: "Allows staff to deactivate existing participant records." },
  { key: "events:view", label: "View events", description: "View events and event attendance lists." },
  { key: "events:manage", label: "Manage events", description: "View, create, and update events." },
  { key: "checkin:record", label: "Check-in", description: "Record attendance at the check-in station." },
  { key: "analytics:view", label: "Analytics", description: "View and refresh participant analytics." },
  { key: "reports:view", label: "Reports", description: "View and export attendance reports and sponsored-child monitoring data when authorized." },
  { key: "sponsorship:view", label: "View sponsored care", description: "View sponsored-child participation and attendance history." },
  { key: "sponsorship:manage", label: "Manage sponsored care", description: "Grant second chances and record sponsorship removals after attendance review." },
];
const DEFAULT_STAFF_PERMISSION_KEYS = STAFF_PERMISSION_OPTIONS
  .map(({ key }) => key)
  .filter((key) => !key.startsWith("sponsorship:") &&
    !["participants:edit", "participants:delete"].includes(key));
const PAGE_PERMISSIONS = {
  dashboard: "dashboard:view",
  participants: "participants:view",
  events: "events:view",
  scanner: "checkin:record",
  analytics: "analytics:view",
  reports: "reports:view",
  sponsorship: "sponsorship:view",
};
const PAGE_ACCESS = {
  account: [...STAFF_ROLES, GOER_ROLE],
  audit: ["system administrator"],
  staff: ["system administrator"],
};
const PAGE_LINKS = [
  ["dashboard", "Dashboard"],
  ["participants", "Participants"],
  ["events", "Events"],
  ["scanner", "Check-in"],
  ["analytics", "Analytics"],
  ["reports", "Reports"],
  ["sponsorship", "Sponsored care"],
  ["staff", "Manage Accounts"],
  ["audit", "Audit history"],
];
const canAccessPermission = (permission, user) => {
  const role = String(user?.role || user || "").toLowerCase();
  if (role === "system administrator") return true;
  if (role === GOER_ROLE) {
    return permission === "dashboard:view" ||
      permission === "checkin:record" ||
      permission === "participants:view" ||
      (permission === "sponsorship:view" &&
        user?.permissions?.includes("goer-care:view"));
  }
  if (!permission || !STAFF_ROLES.includes(role)) return false;
  const permissions = Array.isArray(user?.permissions)
    ? user.permissions
    : DEFAULT_STAFF_PERMISSION_KEYS;
  if (permissions.includes(permission)) return true;
  return (
    (["participants:view", "participants:edit", "participants:delete"].includes(permission) &&
      permissions.includes("participants:manage")) ||
    (permission === "events:view" && permissions.includes("events:manage")) ||
    (permission === "sponsorship:view" && permissions.includes("sponsorship:manage"))
  );
};
const canAccessPage = (page, user) => {
  if (page === "participantHistory") return canAccessPermission("participants:view", user);
  const role = String(user?.role || user || "").toLowerCase();
  if (PAGE_ACCESS[page]) return PAGE_ACCESS[page].includes(role);
  return canAccessPermission(PAGE_PERMISSIONS[page], user);
};
const PARTICIPATION_STATUSES = [
  { value: "ACTIVE", label: "Active" },
  { value: "WARNING", label: "Warning" },
  { value: "GROUNDS_FOR_DEPARTURE", label: "Grounds for Departure" },
  { value: "SECOND_CHANCE", label: "Second Chance" },
  { value: "REMOVED_FROM_SPONSORSHIP", label: "Removed from Sponsorship" },
];
const normalizeParticipationStatus = (value) => {
  const status = String(value || "ACTIVE").toUpperCase().replaceAll(" ", "_");
  return PARTICIPATION_STATUSES.some((item) => item.value === status) ? status : "ACTIVE";
};
const participationStatusLabel = (value) =>
  PARTICIPATION_STATUSES.find((status) => status.value === normalizeParticipationStatus(value))?.label || "Active";
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
function validateParticipantRegistration(form) {
  const errors = {};
  const text = (field) => typeof form[field] === "string" ? form[field] : "";
  const trimmed = (field) => text(field).trim();
  const namePattern = /^\p{L}+(?:[ ]+\p{L}+)*$/u;
  const guardianNamePattern = /^\p{L}+(?:[ '\u2019-]+\p{L}+)*$/u;
  for (const [field, label] of [["firstName", "First name"], ["lastName", "Last name"]]) {
    const value = trimmed(field);
    if (!value) errors[field] = `${label} is required.`;
    else if (value.length > 50) errors[field] = `${label} must be 50 characters or fewer.`;
    else if (value.length < 2 || !namePattern.test(value)) errors[field] = `${label} must contain letters only.`;
  }
  const middleName = trimmed("middleName");
  if (middleName.length > 50) errors.middleName = "Middle name must be 50 characters or fewer.";
  else if (middleName && !namePattern.test(middleName)) errors.middleName = "Middle name must contain letters only.";
  const guardianName = trimmed("emergencyContactName");
  if (!guardianName) errors.emergencyContactName = "Guardian name is required.";
  else if (guardianName.length > 100 || !guardianNamePattern.test(guardianName)) {
    errors.emergencyContactName = "Guardian name must contain a valid name.";
  }
  if (!text("emergencyContactPhone")) errors.emergencyContactPhone = "Guardian contact number is required.";
  else if (!/^09[0-9]{9}$/.test(text("emergencyContactPhone"))) {
    errors.emergencyContactPhone = "Guardian contact number must be 11 digits and start with 09.";
  }

  const dateOfBirth = text("dateOfBirth");
  const parsedBirthDate = /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
    ? new Date(`${dateOfBirth}T00:00:00.000Z`)
    : null;
  const validBirthDate = parsedBirthDate &&
    !Number.isNaN(parsedBirthDate.getTime()) &&
    parsedBirthDate.toISOString().slice(0, 10) === dateOfBirth;
  const age = validBirthDate ? calculateParticipantAge(dateOfBirth) : "";
  if (!dateOfBirth) errors.dateOfBirth = "Date of birth is required.";
  else if (!validBirthDate) errors.dateOfBirth = "Enter a valid date of birth.";
  else if (dateOfBirth > new Date().toISOString().slice(0, 10)) errors.dateOfBirth = "Date of birth cannot be in the future.";
  else if (age < 6) errors.dateOfBirth = "Child must be at least 6 years old.";
  else if (age > 22) errors.dateOfBirth = "Child must not be older than 22 years.";

  if (!GENDER_OPTIONS.includes(text("gender"))) errors.gender = "Please select a sex.";
  const educationLevel = trimmed("educationLevel");
  if (!EDUCATION_LEVELS.includes(educationLevel)) errors.educationLevel = "Please select an education level.";
  else {
    if (!GRADE_LEVELS[educationLevel]?.includes(trimmed("gradeLevel"))) errors.gradeLevel = "Please select a grade/year.";
    if (!trimmed("schoolName")) errors.schoolName = "School currently attending is required.";
    else if (
      trimmed("schoolName").length > 150 ||
      !/\p{L}/u.test(trimmed("schoolName")) ||
      !/^[\p{L}\p{N}\s.'’&,()/-]+$/u.test(trimmed("schoolName"))
    ) errors.schoolName = "Enter a valid school name (150 characters or fewer).";
    if (!trimmed("schoolAddress")) errors.schoolAddress = "School address is required.";
    else if (trimmed("schoolAddress").length > 255) errors.schoolAddress = "School address must be 255 characters or fewer.";
  }
  const programCourse = trimmed("programCourse");
  if (educationLevel === "College" && !programCourse) {
    errors.programCourse = "College students must provide their course.";
  } else if (programCourse.length > 200) {
    errors.programCourse = "College course must be 200 characters or fewer.";
  }

  const address = trimmed("address");
  if (text("address") && !address) errors.address = "Home address cannot contain only spaces.";
  else if (address && address.length < 5) errors.address = "Home address must be at least 5 characters.";
  else if (address.length > 255) errors.address = "Home address must be 255 characters or fewer.";

  for (const [field, label, maximum] of [["weight", "Weight", 500], ["height", "Height", 300]]) {
    const value = text(field);
    if (value && (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) <= 0 || Number(value) > maximum)) {
      errors[field] = `${label} must be a number greater than 0 and no more than ${maximum}.`;
    }
  }
  const medicalConditions = text("medicalConditions");
  if (medicalConditions.length > 500) errors.medicalConditions = "Medical conditions must be 500 characters or fewer.";
  else if (medicalConditions && !medicalConditions.trim()) errors.medicalConditions = "Enter medical conditions or leave this field blank.";
  return errors;
}
function restrictNumericKeyDown(event, allowDecimal = false) {
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    ["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)
  ) return;
  if (/^\d$/.test(event.key)) return;
  if (allowDecimal && event.key === "." && !event.currentTarget.value.includes(".")) return;
  event.preventDefault();
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
  const links = PAGE_LINKS
    .filter(([key]) => canAccessPage(key, user))
    .map(([key, label]) => [
      key,
      String(user.role).toLowerCase() === GOER_ROLE && key === "participants"
        ? "My Participants"
        : label,
    ]);
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
  const required = Boolean(p.required);
  return (
    <div className="col-12 col-md-6">
      <label className="form-label" htmlFor={id}>
        {label}{required && <span aria-hidden="true"> *</span>}
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
const EditIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </svg>
);
const DeleteIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);
const PrintIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 9V3h12v6" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <path d="M6 14h12v7H6z" />
  </svg>
);
const GenderSelect = ({ id, value, onChange, onBlur, required = false, error }) => (
  <div className="col-12 col-md-6">
    <label className="form-label" htmlFor={id}>
      Sex{required && <span aria-hidden="true"> *</span>}
    </label>
    <select
      id={id}
      className={`form-select${error ? " is-invalid" : ""}`}
      value={GENDER_OPTIONS.includes(value) ? value : ""}
      onChange={onChange}
      onBlur={onBlur}
      name="gender"
      required={required}
      aria-invalid={error ? "true" : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <option value="">Select sex</option>
      {GENDER_OPTIONS.map((option) => <option key={option}>{option}</option>)}
    </select>
    {error && <div className="invalid-feedback" id={`${id}-error`} role="alert">{error}</div>}
  </div>
);
function Dashboard({ go, user }) {
  const [d, setD] = useState(null);
  const [greeting, setGreeting] = useState(() => getGreeting());
  const [dashboardError, setDashboardError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () => apiCall("/dashboard")
      .then((data) => {
        if (active) {
          setD(data);
          setDashboardError("");
        }
      })
      .catch((error) => {
        if (active) setDashboardError(error.message);
      });
    load();
    const refresh = () => load();
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    const interval = window.setInterval(() => setGreeting(getGreeting()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
  const isGoer = String(user?.role || "").toLowerCase() === GOER_ROLE;
  const isAdmin = String(user?.role || "").toLowerCase() === "system administrator";
  const canViewParticipants = canAccessPermission("participants:view", user);
  const canManageParticipants = isAdmin;
  const canViewEvents = canAccessPermission("events:view", user);
  const canManageEvents = canAccessPermission("events:manage", user);
  const canCheckIn = canAccessPermission("checkin:record", user);
  const canViewCare = canAccessPermission("sponsorship:view", user);
  const displayName = (user?.fullName || user?.name || "").trim().split(/\s+/)[0];
  const heading = `Good ${greeting}${displayName ? ` ${displayName}` : ""}.`;
  const rateLabel = (period) => `${period?.rate || 0}%`;
  const recentAttendance = d?.recentCheckins || [];
  const followups = d?.followups || [];
  const upcoming = d?.upcomingEvents || [];
  const openActions = [
    ...(isGoer && canViewCare ? [{ label: "My Participants", icon: "→", page: "participants" }] : []),
    ...(canManageParticipants ? [{ label: "Register Participant", icon: "+", page: "participants" }] : []),
    ...(canManageEvents ? [{ label: "Create Event", icon: "+", page: "events" }] : []),
    ...(canCheckIn ? [{ label: "Check-in", icon: "✓", page: "scanner" }] : []),
    ...(canManageParticipants ? [{ label: "Import Data", icon: "⇧", page: "participants" }] : []),
    ...(isAdmin ? [{ label: "Manage Accounts", icon: "⌘", page: "staff" }] : []),
  ];
  const renderEvents = (rows, emptyText) => rows.length ? (
    <ul className="dashboard-list">
      {rows.map((event) => (
        <li key={event.id}>
          <div><strong>{event.name}</strong><small>{new Date(event.starts_at).toLocaleString()} {event.location ? `· ${event.location}` : ""}</small></div>
          {event.status && <span className="dashboard-status">{event.status}</span>}
        </li>
      ))}
    </ul>
  ) : <p className="dashboard-empty">{emptyText}</p>;
  const renderFollowups = () => followups.length ? (
    <ul className="dashboard-list">
      {followups.map((child) => (
        <li key={child.id}>
          <div><strong>{child.name}</strong><small>{child.absent} absences{child.status === "SECOND_CHANCE" ? ` · ${child.postSecondChanceAbsences || 0} after second chance` : ""}</small></div>
          <span className={`dashboard-status ${child.status === "GROUNDS_FOR_DEPARTURE" ? "is-critical" : child.status === "WARNING" ? "is-warning" : ""}`}>{participationStatusLabel(child.status)}</span>
        </li>
      ))}
    </ul>
  ) : <p className="dashboard-empty">No participants require follow-up.</p>;
  const renderAttendance = () => {
    const monthly = d?.monthlyAttendance || [];
    const hasAttendance = monthly.some((period) => period.required > 0);
    return (
      <>
        <div className="dashboard-attendance-periods">
          {[["Today", d?.attendance?.today], ["This Week", d?.attendance?.week], ["This Month", d?.attendance?.month], ["This Year", d?.attendance?.year]].map(([label, period]) => (
            <div key={label}><small>{label}</small><strong>{formatCount(period?.attended || 0)} / {formatCount(period?.required || 0)}</strong><span>{rateLabel(period)}</span></div>
          ))}
        </div>
        <p className="dashboard-absence-total">Total absences this year: <strong>{formatCount(d?.attendance?.year?.absent || 0)}</strong></p>
        <h3 className="dashboard-subheading">Monthly Attendance</h3>
        {hasAttendance ? (
          <div className="dashboard-chart" role="img" aria-label="Monthly attendance this year">
            {monthly.map((month) => {
              const rate = month.required ? Math.max(4, Math.round((month.attended / month.required) * 100)) : 0;
              return <div className="dashboard-chart-row" key={month.month}><span>{new Date(2000, month.month - 1, 1).toLocaleDateString(undefined, { month: "short" })}</span><div><i style={{ width: `${rate}%` }} /></div><small>{month.required ? `${rate}%` : "—"}</small></div>;
            })}
          </div>
        ) : <p className="dashboard-empty">No attendance records yet.</p>}
      </>
    );
  };
  return (
    <>
      <Title
        e={isGoer ? "MY DASHBOARD" : isAdmin ? "COMMAND CENTER" : "STAFF DASHBOARD"}
        t={heading}
        d={isGoer ? `Your ${d?.educationLevel || "assigned"} group’s latest activity.` : "A live overview of participation, attendance, activities, and care."}
      />
      {dashboardError && <div className="alert alert-danger" role="alert">{dashboardError}</div>}
      {!d && !dashboardError && <p className="dashboard-empty" role="status">Loading dashboard data…</p>}
      {d && (
        <>
          <div className="row g-3 mb-4">
            {(isAdmin ? [
              ["Total Participants", d.participantCounts.total, `${formatCount(d.participantCounts.newThisMonth)} new this month`],
              ["Active Participants", d.participantCounts.active, `${formatCount(d.participantCounts.inactive)} inactive`],
              ["Attendance Rate", rateLabel(d.attendance.month), "This month"],
              ["Upcoming Events", d.events.upcoming, "Scheduled"],
            ] : isGoer ? [
              ["My Participants", d.participantCounts.total, d.educationLevel],
              ["Upcoming Activities", d.events.upcoming, "Across your assigned group"],
              ["Attendance This Month", rateLabel(d.attendance.month), `${formatCount(d.attendance.month.attended)} present`],
              ["Needs Follow-up", d.followupCount || 0, "Participants requiring attention"],
            ] : [
              ["Today's Events", d.events.today, "Scheduled for today"],
              ["Today's Check-ins", d.attendance.today.attended, "Recorded attendance"],
              ["Active Participants", d.participantCounts.active, "Participant records"],
              ["Attendance Follow-ups", canViewCare ? d.followupCount || 0 : "—", canViewCare ? "Care status requires review" : "Sponsored-care access not assigned"],
            ]).map(([label, value, caption]) => (
              <div className="col-12 col-sm-6 col-xl-3" key={label}>
                <div className="stat-card"><small>{label}</small><strong>{typeof value === "number" ? formatCount(value) : value}</strong><span>{caption}</span></div>
              </div>
            ))}
          </div>
          {isAdmin && (
            <section className="surface dashboard-section mb-4">
              <div className="dashboard-section-heading"><div><h2>Participant Overview</h2><p>Current participant registry</p></div>{canViewParticipants && <button className="btn btn-outline-primary btn-sm" onClick={() => go("participants")}>View Participants</button>}</div>
              <div className="dashboard-overview-stats">
                {[["Male", d.participantCounts.male], ["Female", d.participantCounts.female], ["Active", d.participantCounts.active], ["Inactive", d.participantCounts.inactive], ["New this month", d.participantCounts.newThisMonth]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{formatCount(value)}</strong></div>)}
              </div>
            </section>
          )}
          {isAdmin && <section className="surface dashboard-section mb-4"><div className="dashboard-section-heading"><div><h2>System Accounts</h2><p>Staff and Goer account totals</p></div></div><div className="dashboard-overview-stats">{[["Total Staff", d.users.totalStaff], ["Active Staff", d.users.activeStaff], ["Goer Accounts", d.users.goerAccounts], ["Church Administrators", d.users.churchAdministrators]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{formatCount(value)}</strong></div>)}</div></section>}
          <div className="row g-4 mb-4">
            <section className={`${isAdmin ? "col-12 col-xl-7" : "col-12 col-xl-6"}`}>
              <article className="surface dashboard-section h-100"><div className="dashboard-section-heading"><div><h2>{isGoer ? "Group Attendance" : "Attendance Overview"}</h2><p>{isGoer ? `Attendance for ${d.educationLevel} participants` : "Based on scheduled events and recorded check-ins"}</p></div>{canCheckIn && <button className="btn btn-outline-primary btn-sm" onClick={() => go("scanner")}>Open Check-in</button>}</div>{renderAttendance()}</article>
            </section>
            <section className={`${isAdmin ? "col-12 col-xl-5" : "col-12 col-xl-6"}`}>
              <article className="surface dashboard-section h-100"><div className="dashboard-section-heading"><div><h2>{isGoer ? "Upcoming Activities" : "Events"}</h2><p>{formatCount(d.events.upcoming)} upcoming · {formatCount(d.events.thisMonth)} this month · {formatCount(d.events.completedThisMonth)} completed this month</p></div>{canViewEvents && <button className="btn btn-outline-primary btn-sm" onClick={() => go("events")}>View Events</button>}</div><h3 className="dashboard-subheading">Today’s Events</h3>{renderEvents(d.todayEvents, "No events scheduled for today.")}<h3 className="dashboard-subheading">Upcoming Events</h3>{renderEvents(upcoming, "No upcoming events.")}</article>
            </section>
          </div>
          {isGoer && (
            <section className="surface dashboard-section mb-4">
              <div className="dashboard-section-heading"><div><h2>My Participants</h2><p>Only active participants in your assigned education group are shown.</p></div>{canViewParticipants && <button className="btn btn-outline-primary btn-sm" onClick={() => go("participants")}>View My Participants</button>}</div>
              {d.groupParticipants?.length ? <div className="dashboard-participant-grid">{d.groupParticipants.map((child) => <article key={child.id}><strong>{child.name}</strong><small>{[child.gender, child.age ? `${child.age} years old` : null].filter(Boolean).join(" · ") || "Participant"}</small><span>Attendance: {child.attendanceRate}%</span></article>)}</div> : <p className="dashboard-empty">No active participants are assigned to your group.</p>}
            </section>
          )}
          {(isAdmin || canViewCare) && (
            <div className="row g-4 mb-4">
              {isAdmin && <section className="col-12 col-lg-5"><article className="surface dashboard-section h-100"><div className="dashboard-section-heading"><div><h2>Sponsored Care</h2><p>Participation status summary</p></div><button className="btn btn-outline-primary btn-sm" onClick={() => go("sponsorship")}>View Sponsored Care</button></div><div className="dashboard-overview-stats">{[["Active", d.sponsoredCare.active], ["Warning", d.sponsoredCare.warning], ["Grounds for Departure", d.sponsoredCare.groundsForDeparture], ["Second Chance", d.sponsoredCare.secondChance], ["Removed", d.sponsoredCare.removed]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{formatCount(value)}</strong></div>)}</div></article></section>}
              <section className={isAdmin ? "col-12 col-lg-7" : "col-12"}><article className="surface dashboard-section h-100"><div className="dashboard-section-heading"><div><h2>Attendance Follow-up</h2><p>Participants who may need a conversation or support</p></div></div>{renderFollowups()}</article></section>
            </div>
          )}
          {!isAdmin && !isGoer && canViewCare && (
            <section className="surface dashboard-section mb-4">
              <div className="dashboard-section-heading"><div><h2>Recent Growth &amp; Activity</h2><p>Latest participant care updates</p></div>{canViewParticipants && <button className="btn btn-outline-primary btn-sm" onClick={() => go("participants")}>View Participants</button>}</div>
              {d.recentCareUpdates?.length ? <ul className="dashboard-list">{d.recentCareUpdates.map((entry) => <li key={entry.id}><div><strong>{entry.participantName}</strong><small>{entry.type === "growth" ? "Growth update" : entry.type === "activity" ? "Activity update" : "Care note"} · {entry.recordedOn ? new Date(entry.recordedOn).toLocaleDateString() : new Date(entry.createdAt).toLocaleDateString()}</small></div></li>)}</ul> : <p className="dashboard-empty">No recent care updates.</p>}
            </section>
          )}
          <div className="row g-4">
            <section className={isAdmin ? "col-12 col-xl-7" : "col-12"}>
              <article className="surface dashboard-section h-100"><div className="dashboard-section-heading"><div><h2>{isAdmin ? "Recent System Activity" : "Recent Check-ins"}</h2><p>{isAdmin ? "Latest recorded check-ins" : "Recent attendance in your operational scope"}</p></div></div>{recentAttendance.length ? <ul className="dashboard-list">{recentAttendance.map((entry, index) => <li key={`${entry.participant_id}-${entry.checked_in_at}-${index}`}><div><strong>{entry.participantName || `Participant #${entry.participant_id}`} checked in</strong><small>{entry.event_name} · {entry.checked_in_at ? new Date(entry.checked_in_at).toLocaleString() : "Time unavailable"}</small></div><span className="dashboard-status is-success">{entry.status}</span></li>)}</ul> : <p className="dashboard-empty">No recent activity.</p>}{isAdmin && d.recentActivity?.length > 0 && <ul className="dashboard-list dashboard-audit-list">{d.recentActivity.map((entry) => <li key={entry.id}><div><strong>{entry.action} · {entry.entity_type}</strong><small>{entry.username} · {new Date(entry.created_at).toLocaleString()}</small></div><span className="dashboard-status">{entry.role}</span></li>)}</ul>}</article>
            </section>
            {openActions.length > 0 && <section className={isAdmin ? "col-12 col-xl-5" : "col-12"}><article className="surface dashboard-section h-100"><div className="dashboard-section-heading"><div><h2>Quick Actions</h2><p>Shortcuts to permitted workflows</p></div></div><div className="dashboard-quick-actions">{openActions.map((action) => <button key={action.label} type="button" className="dashboard-quick-action" onClick={() => go(action.page)}><span>{action.icon}</span><strong>{action.label}</strong></button>)}</div></article></section>}
          </div>
        </>
      )}
    </>
  );
}
function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 1 && hour < 12) return "morning!";
  if (hour >= 12 && hour < 18) return "afternoon!";
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
  const [touchedFields, setTouchedFields] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const [confirmPotentialDuplicate, setConfirmPotentialDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);
  const registrationFormRef = useRef(null);
  const focusFirstInvalidField = (validationErrors) => {
    const firstInvalidField = Object.keys(validationErrors)[0];
    if (!firstInvalidField) return;
    window.requestAnimationFrame(() => {
      const input = registrationFormRef.current?.querySelector(`[name="${firstInvalidField}"]`);
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
      input?.focus({ preventScroll: true });
    });
  };
  const setFieldValue = (key, value) => {
    const next = { ...f, [key]: value };
    setF(next);
    if (submitted || touchedFields[key]) {
      const nextErrors = validateParticipantRegistration(next);
      setFieldErrors((current) => {
        const visibleErrors = { ...current };
        if (submitted) return nextErrors;
        if (nextErrors[key]) visibleErrors[key] = nextErrors[key];
        else delete visibleErrors[key];
        return visibleErrors;
      });
    } else {
      setFieldErrors((current) => ({ ...current, [key]: "" }));
    }
    setError("");
    setDuplicates([]);
    setConfirmPotentialDuplicate(false);
  };
  const update = (key) => (event) => setFieldValue(key, event.target.value);
  const touchField = (key) => {
    setTouchedFields((current) => ({ ...current, [key]: true }));
    const validationErrors = validateParticipantRegistration(f);
    setFieldErrors((current) => ({
      ...current,
      [key]: validationErrors[key] || "",
    }));
  };
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitted(true);
    setTouchedFields(Object.fromEntries(Object.keys(blank).map((key) => [key, true])));
    const validationErrors = validateParticipantRegistration(f);
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length) {
      setError("Please correct the highlighted fields before registering.");
      focusFirstInvalidField(validationErrors);
      return;
    }
    const cleaned = Object.fromEntries(
      Object.entries(f).map(([key, value]) => [
        key,
        typeof value === "string" && key !== "emergencyContactPhone" ? value.trim() : value,
      ]),
    );
    setSaving(true);
    try {
      const created = await apiCall("/participants", {
        method: "POST",
        body: JSON.stringify({
          ...cleaned,
          fullName: composeFullName(cleaned),
          confirmPotentialDuplicate,
        }),
      });
      setR({ ...created, dateOfBirth: cleaned.dateOfBirth });
      setF(blank);
      await onCreated();
    } catch (x) {
      setError(x.message);
      setFieldErrors(x.errors || {});
      if (x.errors && Object.keys(x.errors).length) {
        setSubmitted(true);
        setTouchedFields(Object.fromEntries(Object.keys(blank).map((key) => [key, true])));
        focusFirstInvalidField(x.errors);
      }
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
          <form ref={registrationFormRef} className="participant-registration-form" onSubmit={submit} noValidate>
            <p className="registration-note mb-0">Fields marked * are required. Age is calculated from date of birth.</p>
            <section className="registration-section">
              <header className="registration-section-heading">
                <span>01</span>
                <div><h3>Child details</h3><p>Start with the child’s basic information.</p></div>
              </header>
              <div className="row g-3">
                <Field name="firstName" label="First name" value={f.firstName} onChange={update("firstName")} onBlur={() => touchField("firstName")} maxLength={50} required error={fieldErrors.firstName} />
                <Field name="middleName" label="Middle name (optional)" value={f.middleName} onChange={update("middleName")} onBlur={() => touchField("middleName")} maxLength={50} error={fieldErrors.middleName} />
                <Field name="lastName" label="Last name" value={f.lastName} onChange={update("lastName")} onBlur={() => touchField("lastName")} maxLength={50} required error={fieldErrors.lastName} />
                <Field
                  name="dateOfBirth"
                  label="Date of birth"
                  type="date"
                  value={f.dateOfBirth}
                  onChange={update("dateOfBirth")}
                  onBlur={() => touchField("dateOfBirth")}
                  required
                  error={fieldErrors.dateOfBirth}
                />
                <AgeField dateOfBirth={f.dateOfBirth} />
                <GenderSelect id="register-gender" value={f.gender} onChange={update("gender")} onBlur={() => touchField("gender")} required error={fieldErrors.gender} />
                <Field
                  name="address"
                  label="Home address"
                  placeholder="Street, Barangay, City"
                  value={f.address}
                  onChange={update("address")}
                  onBlur={() => touchField("address")}
                  maxLength={255}
                  error={fieldErrors.address}
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
                      <label className="form-label" htmlFor="register-school-name">School currently attending <span aria-hidden="true">*</span></label>
                      <input
                        id="register-school-name"
                        name="schoolName"
                        className={`form-control${fieldErrors.schoolName ? " is-invalid" : ""}`}
                        value={f.schoolName}
                        onChange={update("schoolName")}
                        onBlur={() => touchField("schoolName")}
                        maxLength={150}
                        required
                        aria-invalid={fieldErrors.schoolName ? "true" : undefined}
                        aria-describedby={`register-school-name-hint${fieldErrors.schoolName ? " register-school-name-error" : ""}`}
                      />
                      {fieldErrors.schoolName && <div className="invalid-feedback d-block" id="register-school-name-error" role="alert">{fieldErrors.schoolName}</div>}
                      <small className="registration-field-hint" id="register-school-name-hint">
                      Enter the full name of the school where the child is currently enrolled.
                      </small>
                    </div>
                    <div className="col-12 col-md-6">
                      <label className="form-label" htmlFor="register-education-level">Education level <span aria-hidden="true">*</span></label>
                      <select
                        id="register-education-level"
                        name="educationLevel"
                        className={`form-select${fieldErrors.educationLevel ? " is-invalid" : ""}`}
                        value={f.educationLevel}
                        onBlur={() => touchField("educationLevel")}
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
                        aria-describedby={fieldErrors.educationLevel ? "register-education-level-error" : undefined}
                      >
                        <option value="">Select education level</option>
                        {EDUCATION_LEVELS.map((level) => <option key={level}>{level}</option>)}
                      </select>
                      {fieldErrors.educationLevel && <div className="invalid-feedback d-block" id="register-education-level-error" role="alert">{fieldErrors.educationLevel}</div>}
                    </div>
                    {f.educationLevel && (
                      <div className="col-12 col-md-6">
                        <label className="form-label" htmlFor="register-grade-level">
                          {f.educationLevel === "College" ? "College year" : "Grade level"} <span aria-hidden="true">*</span>
                        </label>
                        <select
                          id="register-grade-level"
                          name="gradeLevel"
                          className={`form-select${fieldErrors.gradeLevel ? " is-invalid" : ""}`}
                          value={f.gradeLevel}
                          onChange={update("gradeLevel")}
                          onBlur={() => touchField("gradeLevel")}
                          required
                          aria-invalid={fieldErrors.gradeLevel ? "true" : undefined}
                          aria-describedby={fieldErrors.gradeLevel ? "register-grade-level-error" : undefined}
                        >
                          <option value="">Select {f.educationLevel === "College" ? "college year" : "grade level"}</option>
                          {GRADE_LEVELS[f.educationLevel].map((grade) => <option key={grade}>{grade}</option>)}
                        </select>
                        {fieldErrors.gradeLevel && <div className="invalid-feedback d-block" id="register-grade-level-error" role="alert">{fieldErrors.gradeLevel}</div>}
                      </div>
                    )}
                    {f.educationLevel === "College" && (
                      <Field
                        label="College program or course"
                        name="programCourse"
                        value={f.programCourse}
                        onChange={update("programCourse")}
                        onBlur={() => touchField("programCourse")}
                        maxLength={200}
                        required
                        error={fieldErrors.programCourse}
                      />
                    )}
                    <div className="col-12">
                      <label className="form-label" htmlFor="register-school-address">School address <span aria-hidden="true">*</span></label>
                      <textarea
                        id="register-school-address"
                        name="schoolAddress"
                        className={`form-control${fieldErrors.schoolAddress ? " is-invalid" : ""}`}
                        rows="2"
                        maxLength={255}
                        value={f.schoolAddress}
                        onChange={update("schoolAddress")}
                        onBlur={() => touchField("schoolAddress")}
                        required
                        aria-invalid={fieldErrors.schoolAddress ? "true" : undefined}
                        aria-describedby={fieldErrors.schoolAddress ? "register-school-address-error" : undefined}
                      />
                      {fieldErrors.schoolAddress && <div className="invalid-feedback d-block" id="register-school-address-error" role="alert">{fieldErrors.schoolAddress}</div>}
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
                    <div><h3>Health and emergency contact</h3><p>Provide the child’s guardian name and relevant health details.</p></div>
                  </header>
                  <div className="row g-3">
                    <Field
                      name="weight"
                      label="Weight"
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. 32.5"
                      value={f.weight}
                      onChange={update("weight")}
                      onKeyDown={(event) => restrictNumericKeyDown(event, true)}
                      onBlur={() => touchField("weight")}
                      error={fieldErrors.weight}
                    />
                    <Field
                      name="height"
                      label="Height"
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. 132.5"
                      value={f.height}
                      onChange={update("height")}
                      onKeyDown={(event) => restrictNumericKeyDown(event, true)}
                      onBlur={() => touchField("height")}
                      error={fieldErrors.height}
                    />
                    <Field
                      name="medicalConditions"
                      label="Medical conditions"
                      value={f.medicalConditions}
                      onChange={update("medicalConditions")}
                      onBlur={() => touchField("medicalConditions")}
                      maxLength={500}
                      error={fieldErrors.medicalConditions}
                    />
                    <Field
                      name="emergencyContactName"
                      label="Guardian Name"
                      value={f.emergencyContactName}
                      onChange={update("emergencyContactName")}
                      onBlur={() => touchField("emergencyContactName")}
                      maxLength={100}
                      required
                      error={fieldErrors.emergencyContactName}
                    />
                    <Field
                      name="emergencyContactPhone"
                      label="Guardian contact number"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      placeholder="e.g. 09123456789"
                      value={f.emergencyContactPhone}
                      onChange={update("emergencyContactPhone")}
                      onKeyDown={(event) => restrictNumericKeyDown(event)}
                      onBlur={() => touchField("emergencyContactPhone")}
                      pattern="09[0-9]{9}"
                      required
                      error={fieldErrors.emergencyContactPhone}
                    />
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
function formatParticipantHistoryDate(value, options = { year: "numeric", month: "long", day: "numeric" }) {
  if (!value) return "Not recorded";
  const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleDateString(undefined, options);
}
function participantHistoryStatusLabel(value) {
  if (!value) return "Unknown";
  const normalized = String(value).toUpperCase().replaceAll(" ", "_");
  if (PARTICIPATION_STATUSES.some((status) => status.value === normalized)) {
    return participationStatusLabel(normalized);
  }
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

const IMPORT_FIELDS = {
  participants: [
    ["participantIdentifier", "Participant ID"],
    ["fullName", "Participant Name"],
    ["firstName", "First Name"],
    ["middleName", "Middle Name"],
    ["lastName", "Last Name"],
    ["dateOfBirth", "Date of Birth"],
    ["gender", "Sex"],
    ["address", "Address"],
    ["phone", "Phone"],
    ["guardianName", "Guardian Name"],
    ["guardianContact", "Guardian Contact"],
    ["medicalConditions", "Medical Conditions"],
    ["educationLevel", "Education Level"],
    ["currentSchool", "Current School"],
    ["schoolAddress", "School Address"],
    ["gradeLevel", "Grade/Year"],
    ["collegeCourse", "College Course"],
    ["registrationDate", "Registration Date"],
    ["sponsorshipRegistrationDate", "Sponsorship Registration Date"],
  ],
  education: [
    ["participantIdentifier", "Participant ID"],
    ["educationLevel", "Education Level"],
    ["schoolName", "School Name"],
    ["schoolAddress", "School Address"],
    ["startYear", "Start Year"],
    ["endYear", "End Year"],
    ["status", "Status"],
    ["courseStrand", "Course/Strand"],
    ["notes", "Notes"],
  ],
  attendance: [
    ["participantIdentifier", "Participant ID"],
    ["eventId", "Event ID"],
    ["eventName", "Event Name"],
    ["eventDate", "Event Date"],
    ["attendanceStatus", "Attendance Status"],
  ],
  attendanceSummary: [
    ["participantIdentifier", "Participant ID"],
    ["year", "Year"],
    ["required", "Required"],
    ["attended", "Attended"],
    ["absent", "Absent"],
  ],
};

const IMPORT_ALIASES = {
  participantIdentifier: ["participant id", "participant code", "child id", "fmc id", "id"],
  fullName: ["participant name", "child name", "full name", "name"],
  firstName: ["first name", "firstname", "given name"],
  middleName: ["middle name", "middlename"],
  lastName: ["last name", "lastname", "surname", "family name"],
  dateOfBirth: ["dob", "birth date", "date of birth"],
  gender: ["sex", "gender"],
  address: ["address", "home address"],
  phone: ["phone", "phone number", "mobile"],
  guardianName: ["guardian name", "parent name"],
  guardianContact: ["guardian contact", "guardian contact number", "guardian phone", "emergency contact", "emergency contact number"],
  medicalConditions: ["medical conditions", "medical condition"],
  educationLevel: ["education level", "education", "level"],
  currentSchool: ["current school", "school", "school name"],
  schoolName: ["school name", "school", "previous school"],
  schoolAddress: ["school address"],
  gradeLevel: ["grade year", "grade/year", "grade level", "year level"],
  collegeCourse: ["college course", "course", "program"],
  registrationDate: ["registration date", "participant registration date", "date registered"],
  sponsorshipRegistrationDate: ["sponsorship registration date", "sponsorship date", "sponsor date", "date registered for sponsorship"],
  startYear: ["start year", "start"],
  endYear: ["end year", "end"],
  status: ["status", "education status"],
  courseStrand: ["course strand", "strand", "course"],
  notes: ["notes", "remarks"],
  eventId: ["event id"],
  eventName: ["event name", "event"],
  eventDate: ["event date", "attendance date", "date"],
  attendanceStatus: ["attendance status", "status", "attendance"],
  year: ["year", "attendance year"],
  required: ["required", "required activities"],
  attended: ["attended", "attended activities"],
  absent: ["absent", "absences"],
};

function normalizeImportDate(value) {
  const text = String(value || "").trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const local = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (local) return `${local[3]}-${local[1].padStart(2, "0")}-${local[2].padStart(2, "0")}`;
  return text;
}

function csvDownload(fileName, rows) {
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const content = rows.map((row) => row.map(escape).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ImportDataModal({ onClose, onCompleted }) {
  const [importType, setImportType] = useState("participants");
  const [file, setFile] = useState(null);
  const [worksheet, setWorksheet] = useState(null);
  const [mapping, setMapping] = useState([]);
  const [preview, setPreview] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    apiCall("/participants/import/history").then(setHistory).catch((requestError) => setError(requestError.message));
  }, []);

  const chooseImportType = (value) => {
    setImportType(value);
    setFile(null);
    setWorksheet(null);
    setPreview(null);
    setResult(null);
    setError("");
  };
  const inspectFile = async (selectedFile) => {
    setError("");
    setPreview(null);
    setResult(null);
    setWorksheet(null);
    if (!selectedFile) return;
    const extension = selectedFile.name.split(".").pop()?.toLowerCase();
    if (!["csv", "xlsx", "xls"].includes(extension)) {
      setFile(null);
      setError("Unsupported file type. Choose a .csv, .xlsx, or .xls file.");
      return;
    }
    if (selectedFile.size > 5 * 1024 * 1024) {
      setFile(null);
      setError("Files must be 5 MB or smaller.");
      return;
    }
    setFile(selectedFile);
    setLoading(true);
    try {
      const buffer = await selectedFile.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      const inspected = await apiCall("/participants/import/inspect", {
        method: "POST",
        body: JSON.stringify({ fileName: selectedFile.name, fileData: btoa(binary) }),
      });
      setWorksheet(inspected);
      const availableFields = IMPORT_FIELDS[importType].map(([key]) => key);
      setMapping(inspected.headers.map((header) => {
        const normalized = String(header).trim().toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");
        const matched = availableFields.find((key) => IMPORT_ALIASES[key]?.includes(normalized));
        return matched || "";
      }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };
  const mappedRows = () => worksheet.rows
    .map((values, rowIndex) => {
      const row = { rowNumber: rowIndex + 2 };
      mapping.forEach((field, columnIndex) => {
        if (field) row[field] = String(values[columnIndex] ?? "").trim();
      });
      for (const field of ["dateOfBirth", "registrationDate", "sponsorshipRegistrationDate", "eventDate"]) {
        if (row[field]) row[field] = normalizeImportDate(row[field]);
      }
      for (const field of ["eventId", "startYear", "endYear"]) {
        if (row[field] !== undefined && row[field] !== "") row[field] = String(row[field]).trim();
      }
      return row;
    })
    .filter((row) => Object.keys(row).some((key) => key !== "rowNumber" && row[key] !== ""));
  const validate = async () => {
    if (!worksheet) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiCall("/participants/import/preview", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, importType, rows: mappedRows() }),
      });
      setPreview(data);
      const initialDecisions = {};
      data.rows.forEach((row) => {
        if (row.operation === "review") initialDecisions[row.rowNumber] = "skip";
      });
      setDecisions(initialDecisions);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };
  const commit = async () => {
    if (!preview) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiCall("/participants/import/commit", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          importType,
          rows: mappedRows(),
          decisions,
        }),
      });
      setResult(data);
      setPreview(null);
      setHistory(await apiCall("/participants/import/history"));
      await onCompleted();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };
  const downloadTemplate = (type) => {
    const fields = IMPORT_FIELDS[type].map(([, label]) => label);
    const name = type === "participants" ? "participant-template.csv"
      : type === "education" ? "education-history-template.csv" : "attendance-template.csv";
    csvDownload(name, [fields]);
  };
  const downloadErrors = () => {
    if (!preview) return;
    const rows = [["Row", "Errors", "Warnings"]];
    preview.rows.filter((row) => !row.valid || row.warnings.length)
      .forEach((row) => rows.push([row.rowNumber, row.errors.join("; "), row.warnings.join("; ")]));
    csvDownload("participant-import-errors.csv", rows);
  };

  return createPortal(
    <div className="participant-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !loading) onClose();
    }}>
      <section className="participant-modal" role="dialog" aria-modal="true" aria-labelledby="participant-import-title">
        <header className="d-flex justify-content-between align-items-start gap-3 mb-4">
          <div>
            <span className="eyebrow">PARTICIPANTS / IMPORT</span>
            <h2 id="participant-import-title">Import Data</h2>
            <p className="text-secondary mb-0">Supported formats: Excel (.xlsx, .xls) and CSV (.csv). Maximum file size: 5 MB.</p>
          </div>
          <button type="button" className="btn-close" aria-label="Close import dialog" onClick={onClose} disabled={loading} />
        </header>
        {error && <div className="alert alert-danger" role="alert">{error}</div>}
        {result ? (
          <div className="alert alert-success" role="status">
            <h3>Import completed successfully.</h3>
            <p className="mb-1">Participants imported: {result.participantsImported}</p>
            <p className="mb-1">Participants updated: {result.participantsUpdated}</p>
            <p className="mb-1">Attendance records imported: {result.attendanceImported}</p>
            <p className="mb-1">Historical attendance summaries imported: {result.attendanceSummariesImported}</p>
            <p className="mb-1">Education records imported: {result.educationImported}</p>
            <p className="mb-0">Skipped: {result.skipped} · Errors: {result.failed}</p>
          </div>
        ) : (
          <>
            <div className="row g-3 mb-3">
              <div className="col-12 col-md-6">
                <label className="form-label" htmlFor="participant-import-type">Import type</label>
                <select id="participant-import-type" className="form-select" value={importType} onChange={(event) => chooseImportType(event.target.value)}>
                  <option value="participants">Participant information</option>
                  <option value="education">Education history</option>
                  <option value="attendance">Detailed attendance records</option>
                  <option value="attendanceSummary">Historical attendance summary</option>
                </select>
              </div>
              <div className="col-12 col-md-6">
                <label className="form-label" htmlFor="participant-import-file">Upload file</label>
                <input id="participant-import-file" className="form-control" type="file" accept=".csv,.xlsx,.xls" disabled={loading} onChange={(event) => inspectFile(event.target.files?.[0])} />
              </div>
            </div>
            <div className="d-flex flex-wrap gap-2 mb-4">
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => downloadTemplate("participants")}>Download Participant Template</button>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => downloadTemplate("education")}>Download Education History Template</button>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => downloadTemplate("attendance")}>Download Attendance Template</button>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => downloadTemplate("attendanceSummary")}>Download Attendance Summary Template</button>
            </div>
            {worksheet && (
              <>
                <h3>Step 2 — Map your columns</h3>
                <p className="text-secondary">Review and adjust every suggested mapping before validating.</p>
                <div className="table-responsive mb-4">
                  <table className="table align-middle">
                    <thead><tr><th>File column</th><th>Map to system field</th></tr></thead>
                    <tbody>{worksheet.headers.map((header, index) => (
                      <tr key={`${header}-${index}`}>
                        <td>{header}</td>
                        <td>
                          <select className="form-select" aria-label={`Map ${header}`} value={mapping[index] || ""} onChange={(event) => setMapping((current) => current.map((field, column) => column === index ? event.target.value : field))}>
                            <option value="">Do not import</option>
                            {IMPORT_FIELDS[importType].map(([key, label]) => <option value={key} key={key}>{label}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </>
            )}
            {preview && (
              <section className="mb-4">
                <h3>Step 3 — Validate and preview</h3>
                <p>Total rows: {preview.totalRows} · Valid: {preview.validRows} · Warnings: {preview.warningCount} · Errors: {preview.errorCount}</p>
                <div className="table-responsive">
                  <table className="table table-sm align-middle">
                    <thead><tr><th>Row</th><th>Operation</th><th>Validation</th></tr></thead>
                    <tbody>{preview.rows.slice(0, 100).map((row) => (
                      <tr key={row.rowNumber}>
                        <td>{row.rowNumber}</td>
                        <td>
                          {row.operation === "review" && row.valid ? (
                            <select className="form-select form-select-sm" value={decisions[row.rowNumber] || "skip"} onChange={(event) => setDecisions((current) => ({ ...current, [row.rowNumber]: event.target.value }))}>
                              <option value="skip">Skip</option>
                              {importType === "participants" && <><option value="update">Update Existing</option><option value="create">Create New</option></>}
                            </select>
                          ) : (row.valid ? row.operation : "Error")}
                        </td>
                        <td>{row.errors.map((item) => <div className="text-danger" key={item}>✕ {item}</div>)}{row.warnings.map((item) => <div className="text-warning-emphasis" key={item}>⚠ {item}</div>)}{row.valid && !row.warnings.length && <span>✓ Valid</span>}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                {preview.rows.length > 100 && <p className="text-secondary">Showing the first 100 of {preview.rows.length} rows.</p>}
                {preview.errorCount > 0 && <button type="button" className="btn btn-outline-danger btn-sm" onClick={downloadErrors}>Download Error Report</button>}
              </section>
            )}
            <footer className="d-flex flex-wrap justify-content-between gap-2">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={loading}>Cancel</button>
              <div className="d-flex gap-2">
                {worksheet && !preview && <button type="button" className="btn btn-primary" onClick={validate} disabled={loading || !mapping.some(Boolean)}>{loading ? "Validating…" : "Validate and Preview"}</button>}
                {preview && <button type="button" className="btn btn-dark" onClick={commit} disabled={loading || preview.validRows === 0}>{loading ? "Importing…" : "Import Valid Records"}</button>}
              </div>
            </footer>
          </>
        )}
        <section className="mt-4">
          <h3>Import History</h3>
          {history.length ? (
            <div className="table-responsive"><table className="table table-sm">
              <thead><tr><th>File</th><th>Imported by</th><th>Date</th><th>Type</th><th>Records</th><th>Failed</th></tr></thead>
              <tbody>{history.map((item) => (
                <tr key={item.id}><td>{item.file_name}</td><td>{item.imported_by_name}</td><td>{formatParticipantHistoryDate(item.created_at)}</td><td>{item.import_type}</td><td>{Number(item.participants_imported) + Number(item.participants_updated) + Number(item.attendance_imported) + Number(item.attendance_summaries_imported) + Number(item.education_imported)}</td><td>{item.failed}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <p className="text-secondary">No previous imports.</p>}
        </section>
      </section>
    </div>,
    document.body,
  );
}

function ParticipantHistoryPage({ participantId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  const [attendanceView, setAttendanceView] = useState("monthly");
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
  const [attendanceFilters, setAttendanceFilters] = useState({
    year: "",
    month: "",
    event: "",
    status: "",
  });
  const [attendancePage, setAttendancePage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const chartRef = useRef(null);
  const chartCanvasRef = useRef(null);
  const attendanceQuery = new URLSearchParams({
    page: String(attendancePage),
    pageSize: "10",
    historyPage: String(historyPage),
    historyPageSize: "10",
    trendYear: selectedYear,
    year: attendanceFilters.year,
    month: attendanceFilters.month,
    event: attendanceFilters.event,
    status: attendanceFilters.status,
  });
  const attendanceQueryString = attendanceQuery.toString();
  useEffect(() => {
    let active = true;
    apiCall(`/participants/${participantId}/history?${attendanceQueryString}`)
      .then((response) => {
        if (active) {
          setData(response);
          setError("");
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || "Unable to load participant history.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [participantId, attendanceQueryString]);
  useEffect(() => {
    if (loading || tab !== "attendance" || !chartCanvasRef.current || !data) return undefined;
    const points = attendanceView === "monthly"
      ? data.attendanceByMonth || []
      : data.attendanceByYear || [];
    chartRef.current?.destroy();
    chartRef.current = new Chart(chartCanvasRef.current, {
      type: "bar",
      data: {
        labels: points.map((point) => attendanceView === "monthly"
          ? new Date(2000, point.month - 1, 1).toLocaleDateString(undefined, { month: "short" })
          : String(point.year)),
        datasets: [{
          label: "Attendance rate",
          data: points.map((point) => point.attendanceRate || 0),
          backgroundColor: "#1782c4",
          borderRadius: 6,
          maxBarThickness: 38,
        }],
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { callback: (value) => `${value}%` } },
        },
        plugins: { legend: { display: false } },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [data, loading, tab, attendanceView, selectedYear]);
  const updateAttendanceFilter = (key) => (event) => {
    setLoading(true);
    setAttendanceFilters((current) => ({ ...current, [key]: event.target.value }));
    setAttendancePage(1);
  };
  const changeAttendancePage = (nextPage) => {
    setLoading(true);
    setAttendancePage(nextPage);
  };
  const changeHistoryPage = (nextPage) => {
    setLoading(true);
    setHistoryPage(nextPage);
  };
  const participant = data?.participant;
  const summary = data?.summary || {};
  const attendance = data?.attendance || { records: [], page: 1, pageSize: 10, total: 0 };
  const history = data?.history || { records: [], page: 1, pageSize: 10, total: 0 };
  const attendancePages = Math.max(1, Math.ceil(attendance.total / attendance.pageSize));
  const historyPages = Math.max(1, Math.ceil(history.total / history.pageSize));
  const years = [...new Set([
    new Date().getFullYear(),
    ...(data?.attendanceByYear || []).map((entry) => entry.year),
  ])].sort((first, second) => second - first);
  const monthlyAttendance = data?.attendanceByMonth || [];
  const selectedYearData = (data?.attendanceByYear || []).find(
    (entry) => String(entry.year) === selectedYear,
  );
  if (loading && !data) {
    return <div className="participant-history-loading" role="status">Loading participant history…</div>;
  }
  if (error && !data) {
    return (
      <section className="participant-history-page">
        <button type="button" className="btn btn-outline-primary mb-4" onClick={onBack}>← Back to Participants</button>
        <div className="alert alert-danger" role="alert">{error}</div>
      </section>
    );
  }
  if (!participant) {
    return (
      <section className="participant-history-page">
        <button type="button" className="btn btn-outline-primary mb-4" onClick={onBack}>← Back to Participants</button>
        <div className="alert alert-warning" role="status">Participant not found.</div>
      </section>
    );
  }
  const isSponsoredChild = participant.participantType === "sponsored_child";
  const participation = data?.participation;
  return (
    <section className="participant-history-page">
      <button type="button" className="participant-history-back" onClick={onBack}>← Back to Participants</button>
      <header className="participant-history-hero">
        <div>
          <span className="eyebrow">PARTICIPANTS / HISTORY</span>
          <h1>{participant.name || "Unnamed participant"}</h1>
          <div className="participant-history-identity">
            <span>{participant.participantCode || `Participant #${participant.id}`}</span>
            <span className="participant-history-status">{participantHistoryStatusLabel(participant.status)}</span>
            <span>{Number.isFinite(participant.age) ? `${participant.age} years old` : "Age not recorded"}</span>
          </div>
        </div>
      </header>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {loading && <div className="participant-history-refresh" role="status">Refreshing history…</div>}
      <div className="participant-history-summary">
        {[
          ["Registration Date", formatParticipantHistoryDate(summary.registrationDate)],
          ["Activities Attended", formatCount(participation?.lifetime.attended ?? summary.totalAttended)],
          ["Attendance Rate", `${participation?.lifetime.attendanceRate ?? summary.attendanceRate ?? 0}%`],
          ["Total Absences", formatCount(participation?.lifetime.absent ?? summary.totalAbsences)],
        ].map(([label, value]) => (
          <article className="participant-history-summary-card" key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </article>
        ))}
      </div>
      <nav className="participant-history-tabs" aria-label="Participant history sections">
        {[
          ["overview", "Overview"],
          ["attendance", "Attendance"],
          ...(isSponsoredChild ? [["sponsorship", "Participation"]] : []),
          ["history", "History"],
        ].map(([value, label]) => (
          <button
            type="button"
            className={tab === value ? "active" : ""}
            aria-current={tab === value ? "page" : undefined}
            key={value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "overview" && (
        <div className="participant-history-content">
          <div className="participant-history-overview-grid">
            <article className="surface participant-history-section">
              <h2>Registration information</h2>
              <dl className="participant-history-details">
                <div><dt>Registration date</dt><dd>{formatParticipantHistoryDate(participant.registrationDate)}</dd></div>
                  <div><dt>Sponsorship registered</dt><dd>{formatParticipantHistoryDate(participant.sponsorshipRegistrationDate)}</dd></div>
                  <div><dt>Participant ID</dt><dd>{participant.participantCode || `Participant #${participant.id}`}</dd></div>
                  <div><dt>Initial status</dt><dd>{participantHistoryStatusLabel(participant.initialStatus)}</dd></div>
                  <div><dt>Current status</dt><dd>{participantHistoryStatusLabel(participant.status)}</dd></div>
                  <div><dt>Current education level</dt><dd>{participant.educationLevel || "Not recorded"}</dd></div>
                  <div><dt>Grade / year</dt><dd>{participant.gradeLevel || "Not recorded"}</dd></div>
                  {participant.programCourse && <div><dt>Course</dt><dd>{participant.programCourse}</dd></div>}
                  {participant.schoolName && <div><dt>Current school</dt><dd>{participant.schoolName}</dd></div>}
                  {participant.schoolAddress && <div><dt>School address</dt><dd>{participant.schoolAddress}</dd></div>}
              </dl>
            </article>
            <article className="surface participant-history-section">
              <h2>Attendance summary</h2>
              <div className="participant-history-attendance-numbers">
                <div><strong>{formatCount(participation?.lifetime.attended ?? summary.totalAttended)}</strong><span>Attended</span></div>
                <div><strong>{formatCount(participation?.lifetime.absent ?? summary.totalAbsences)}</strong><span>Absent</span></div>
                <div><strong>{formatCount(participation?.lifetime.required ?? summary.totalEvents)}</strong><span>Required activities</span></div>
                <div><strong>{participation?.lifetime.attendanceRate ?? summary.attendanceRate ?? 0}%</strong><span>Attendance rate</span></div>
              </div>
              {isSponsoredChild && <p className="mb-0">Participation status: <strong>{participantHistoryStatusLabel(participant.status)}</strong></p>}
            </article>
          </div>
          <article className="surface participant-history-section">
            <h2>Education History</h2>
            <p className="text-secondary">View the schools and education levels previously attended by the participant.</p>
            {participant.educationHistory?.length ? (
              <ul className="participation-event-history">
                {participant.educationHistory.map((record) => (
                  <li key={record.id}>
                    <span className="attendance-check">{record.endYear || record.startYear}</span>
                    <div>
                      <strong>{record.status} {record.educationLevel}</strong>
                      <small>{record.schoolName} · {record.startYear} – {record.endYear || (record.status === "Currently Attending" ? "Present" : "End year not recorded")}</small>
                      {record.courseStrand && <small>{record.courseStrand}</small>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-secondary mb-0">No education history has been recorded.</p>}
          </article>
          <article className="surface participant-history-section">
            <h2>Weekly Attendance — Current Month</h2>
            {data?.currentMonthWeeklyAttendance?.length ? (
              <ul className="participation-event-history">
                {data.currentMonthWeeklyAttendance.map((week) => (
                  <li key={week.week}>
                    <span className={week.totalAttended ? "attendance-check" : "attendance-missed"}>
                      {week.totalAttended ? "✓" : "×"}
                    </span>
                    <div>
                      <strong>Week {week.week}</strong>
                      <small>{week.totalAttended}/{week.totalEvents} attended · {week.totalEvents - week.totalAttended} absent</small>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-secondary mb-0">No events recorded for the current month.</p>}
          </article>
          <article className="surface participant-history-section">
            <div className="participant-history-section-heading">
              <h2>Recent attendance</h2>
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setTab("attendance")}>View attendance</button>
            </div>
            {attendance.records.length ? (
              <div className="table-responsive">
                <table className="table align-middle participant-history-table">
                  <thead><tr><th>Event</th><th>Event date</th><th>Check-in time</th><th>Status</th></tr></thead>
                  <tbody>{attendance.records.slice(0, 5).map((record, index) => (
                    <tr key={`${record.event}-${record.eventDate}-${index}`}>
                      <td>{record.event}</td>
                      <td>{formatParticipantHistoryDate(record.eventDate)}</td>
                      <td>{record.checkedInAt ? formatParticipantHistoryDate(record.checkedInAt, { hour: "numeric", minute: "2-digit" }) : "—"}</td>
                      <td><span className={`participant-history-record-status ${record.status}`}>{participantHistoryStatusLabel(record.status)}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="text-secondary mb-0">No attendance records found.</p>}
          </article>
          <article className="surface participant-history-section">
            <div className="participant-history-section-heading">
              <h2>Recent history</h2>
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setTab("history")}>View full history</button>
            </div>
            {history.records.length ? (
              <ul className="participant-history-timeline participant-history-timeline-compact">
                {history.records.slice(0, 5).map((record, index) => (
                  <li key={`${record.eventAt}-${record.title}-${index}`}>
                    <time>{formatParticipantHistoryDate(record.eventAt)}</time>
                    <strong>{record.title}</strong>
                    {record.description && <span>{record.description}</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-secondary mb-0">No history available.</p>}
          </article>
        </div>
      )}
      {tab === "attendance" && (
        <div className="participant-history-content">
          <div className="participant-history-attendance-heading">
            <div><h2>Attendance history</h2><p>Attendance is calculated from recorded events and this participant’s check-ins.</p></div>
            <div className="participant-history-view-toggle" role="group" aria-label="Attendance trend view">
              <button type="button" className={attendanceView === "monthly" ? "active" : ""} onClick={() => setAttendanceView("monthly")}>Monthly</button>
              <button type="button" className={attendanceView === "yearly" ? "active" : ""} onClick={() => setAttendanceView("yearly")}>Yearly</button>
            </div>
            {attendanceView === "monthly" && (
              <label className="participant-history-year-select">
                <span>Trend year</span>
                <select className="form-select" value={selectedYear} onChange={(event) => { setLoading(true); setSelectedYear(event.target.value); }}>
                  {years.map((year) => <option value={year} key={year}>{year}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="participant-history-attendance-numbers">
            <div><strong>{formatCount(summary.totalAttended)}</strong><span>Total events attended</span></div>
            <div><strong>{formatCount(summary.totalAbsences)}</strong><span>Total absences</span></div>
            <div><strong>{formatCount(summary.totalEvents)}</strong><span>Total events</span></div>
            <div><strong>{attendanceView === "yearly" && selectedYearData ? selectedYearData.attendanceRate : summary.attendanceRate || 0}%</strong><span>Attendance percentage</span></div>
          </div>
          <article className="surface participant-history-chart">
            <div className="participant-history-chart-canvas"><canvas ref={chartCanvasRef} aria-label={`${attendanceView} attendance trend`} /></div>
          </article>
          <article className="surface participant-history-section">
            <h2>{attendanceView === "monthly" ? `Monthly attendance — ${selectedYear}` : "Yearly attendance"}</h2>
            <div className="table-responsive">
              <table className="table align-middle participant-history-table">
                <thead><tr><th>{attendanceView === "monthly" ? "Month" : "Year"}</th><th>Attended</th><th>Total events</th><th>Attendance</th></tr></thead>
                <tbody>
                  {(attendanceView === "monthly" ? monthlyAttendance : data?.attendanceByYear || []).map((entry) => {
                    const label = attendanceView === "monthly"
                      ? new Date(2000, entry.month - 1, 1).toLocaleDateString(undefined, { month: "long" })
                      : entry.year;
                    const rate = entry.attendanceRate ?? (entry.totalEvents
                      ? Math.round((entry.totalAttended / entry.totalEvents) * 1000) / 10
                      : 0);
                    return <tr key={label}><td>{label}</td><td>{entry.totalAttended}</td><td>{entry.totalEvents}</td><td>{rate}%</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          </article>
          <article className="surface participant-history-section">
            <h2>Historical Attendance Summary (Imported)</h2>
            <p className="text-secondary">Yearly summaries are preserved separately and do not replace detailed event attendance or affect participation status.</p>
            {data?.historicalAttendanceSummary?.length ? (
              <div className="table-responsive">
                <table className="table align-middle participant-history-table">
                  <thead><tr><th>Year</th><th>Required</th><th>Attended</th><th>Absent</th><th>Attendance rate</th></tr></thead>
                  <tbody>{data.historicalAttendanceSummary.map((entry) => (
                    <tr key={entry.year}><td>{entry.year}</td><td>{entry.required}</td><td>{entry.attended}</td><td>{entry.absent}</td><td>{entry.attendanceRate}%</td></tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="text-secondary mb-0">No historical attendance summaries imported.</p>}
          </article>
          <article className="surface participant-history-section">
            <h2>Attendance records</h2>
            <div className="participant-history-filters">
              <label><span>Year</span><select className="form-select" value={attendanceFilters.year} onChange={updateAttendanceFilter("year")}><option value="">All years</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
              <label><span>Month</span><select className="form-select" value={attendanceFilters.month} onChange={updateAttendanceFilter("month")}><option value="">All months</option>{Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <option key={month} value={month}>{new Date(2000, month - 1, 1).toLocaleDateString(undefined, { month: "long" })}</option>)}</select></label>
              <label><span>Event</span><select className="form-select" value={attendanceFilters.event} onChange={updateAttendanceFilter("event")}><option value="">All events</option>{(data?.eventOptions || []).map((event) => <option key={event} value={event}>{event}</option>)}</select></label>
              <label><span>Status</span><select className="form-select" value={attendanceFilters.status} onChange={updateAttendanceFilter("status")}><option value="">All statuses</option><option value="attended">Attended</option><option value="missed">Missed</option></select></label>
            </div>
            {attendance.records.length ? (
              <>
                <div className="table-responsive">
                  <table className="table align-middle participant-history-table">
                    <thead><tr><th>Event</th><th>Event date</th><th>Check-in time</th><th>Status</th></tr></thead>
                    <tbody>{attendance.records.map((record, index) => (
                      <tr key={`${record.event}-${record.eventDate}-${index}`}>
                        <td>{record.event}</td>
                        <td>{formatParticipantHistoryDate(record.eventDate)}</td>
                        <td>{record.checkedInAt ? formatParticipantHistoryDate(record.checkedInAt, { hour: "numeric", minute: "2-digit" }) : "—"}</td>
                        <td><span className={`participant-history-record-status ${record.status}`}>{participantHistoryStatusLabel(record.status)}</span></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div className="participant-history-pagination">
                  <span>{attendance.total} attendance records</span>
                  <button type="button" className="btn btn-sm btn-outline-primary" disabled={attendancePage <= 1} onClick={() => changeAttendancePage(attendancePage - 1)}>Previous</button>
                  <span>Page {attendancePage} of {attendancePages}</span>
                  <button type="button" className="btn btn-sm btn-outline-primary" disabled={attendancePage >= attendancePages} onClick={() => changeAttendancePage(attendancePage + 1)}>Next</button>
                </div>
              </>
            ) : <p className="text-secondary mb-0">No attendance records found.</p>}
          </article>
        </div>
      )}
      {tab === "sponsorship" && isSponsoredChild && participation && (
        <div className="participant-history-content">
          <article className="surface participant-history-section">
            <h2>Monthly participation</h2>
            <div className="table-responsive">
              <table className="table align-middle participant-history-table">
                <thead><tr><th>Month</th><th>Required</th><th>Attended</th><th>Absent</th><th>Attendance</th><th>Status</th></tr></thead>
                <tbody>{participation.months.map((month) => (
                  <tr key={month.key}>
                    <td>{new Date(`${month.key}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</td>
                    <td>{month.required}</td><td>{month.attended}</td><td>{month.absent}</td><td>{month.attendanceRate}%</td>
                    <td>{month.status === "ACTIVE" ? "Active" : "Warning"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </article>
          <article className="surface participant-history-section">
            <h2>Participation status history</h2>
            {participation.history.length ? (
              <ul className="participation-event-history">
                {participation.history.map((entry) => (
                  <li key={entry.id}><span className="attendance-check">✓</span><div><strong>{participantHistoryStatusLabel(entry.currentStatus)}</strong><small>{formatParticipantHistoryDate(entry.createdAt)} · {entry.administrator}{entry.reason ? ` · ${entry.reason}` : ""}</small></div></li>
                ))}
              </ul>
            ) : <p className="text-secondary mb-0">No participation status changes recorded.</p>}
          </article>
        </div>
      )}
      {tab === "history" && (
        <div className="participant-history-content">
          <article className="surface participant-history-section">
            <h2>Participant history</h2>
            {history.records.length ? (
              <>
                <ul className="participant-history-timeline">
                  {history.records.map((record, index) => (
                    <li key={`${record.eventAt}-${record.title}-${index}`}>
                      <time>{formatParticipantHistoryDate(record.eventAt)}</time>
                      <strong>{record.title}</strong>
                      {record.description && <span>{record.description}</span>}
                    </li>
                  ))}
                </ul>
                <div className="participant-history-pagination">
                  <span>{history.total} history events</span>
                  <button type="button" className="btn btn-sm btn-outline-primary" disabled={historyPage <= 1} onClick={() => changeHistoryPage(historyPage - 1)}>Previous</button>
                  <span>Page {historyPage} of {historyPages}</span>
                  <button type="button" className="btn btn-sm btn-outline-primary" disabled={historyPage >= historyPages} onClick={() => changeHistoryPage(historyPage + 1)}>Next</button>
                </div>
              </>
            ) : <p className="text-secondary mb-0">No history available.</p>}
          </article>
        </div>
      )}
    </section>
  );
}
function Participants({ canCreateImport, canEdit, canDelete, isGoer, user, onViewHistory }) {
  const canViewSponsorship = canAccessPermission("sponsorship:view", user);
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [genderFilter, setGenderFilter] = useState("all");
  const [recordStatusFilter, setRecordStatusFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [showRegistration, setShowRegistration] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [educationHistory, setEducationHistory] = useState([]);
  const [growthUpdates, setGrowthUpdates] = useState([]);
  const [profileAttendance, setProfileAttendance] = useState(null);
  const [educationDraft, setEducationDraft] = useState({
    educationLevel: "",
    schoolName: "",
    schoolAddress: "",
    startYear: "",
    endYear: "",
    status: "",
    courseStrand: "",
    notes: "",
  });
  const [addingEducation, setAddingEducation] = useState(false);
  const [educationFilter, setEducationFilter] = useState("all");
  const [childStatusFilter, setChildStatusFilter] = useState("all");
  const [visiblePasscode, setVisiblePasscode] = useState(null);
  const [passcodeMessage, setPasscodeMessage] = useState("");
  const [loadingPasscode, setLoadingPasscode] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (!confirmDelete) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !deleting) setConfirmDelete(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [confirmDelete, deleting]);
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
    setGrowthUpdates([]);
    setProfileAttendance(null);
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
  const choose = async (id, startEditing = false) => {
    try {
      const selectedRow = list.find((participant) => String(participant.id) === String(id));
      const shouldLoadGrowth = canViewSponsorship && selectedRow?.participant_type === "sponsored_child";
      const growthUpdatesPromise = shouldLoadGrowth
        ? apiCall(`/sponsorship/children/${id}/updates`)
          .then((updates) => ({ updates }))
          .catch((requestError) => ({ updates: [], loadError: requestError.message }))
        : Promise.resolve({ updates: [] });
      const [data, educationRows, attendanceData, growthData] = await Promise.all([
        apiCall(`/participants/${id}`),
        apiCall(`/participants/${id}/education-history`),
        apiCall(`/participants/${id}/history`).catch((requestError) => ({ loadError: requestError.message })),
        growthUpdatesPromise,
      ]);
      setSelected(id);
      setEducationHistory(educationRows);
      setGrowthUpdates(growthData.updates);
      setProfileAttendance(attendanceData.loadError ? null : attendanceData);
      setVisiblePasscode(null);
      setPasscodeMessage("");
      setForm({
        ...data.participant,
        participantType: data.participant.participant_type,
        sponsorshipRegistrationDate: data.participant.sponsorship_registered_at || "",
        ...participantNameFields(data.participant),
        passcode: '',
      });
      setEditing(startEditing);
      setAddingEducation(false);
      setMessage(attendanceData.loadError
        ? `Attendance details could not be loaded: ${attendanceData.loadError}`
        : growthData.loadError ? `Growth & Activity could not be loaded: ${growthData.loadError}` : "");
      return true;
    } catch (error) {
      setMessage(error.message);
      return false;
    }
  };
  const saveEducationRecord = async (event) => {
    event.preventDefault();
    if (!selected) return;
    try {
      await apiCall(`/participants/${selected}/education-history`, {
        method: "POST",
        body: JSON.stringify(educationDraft),
      });
      setEducationHistory(await apiCall(`/participants/${selected}/education-history`));
      setEducationDraft({
        educationLevel: "",
        schoolName: "",
        schoolAddress: "",
        startYear: "",
        endYear: "",
        status: "",
        courseStrand: "",
        notes: "",
      });
      setAddingEducation(false);
      setMessage("Education history saved.");
    } catch (requestError) {
      setMessage(requestError.message);
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
      delete changes.lifecycle;
      delete changes.monthlyAllowance;
      const data = await apiCall(`/participants/${selected}`, {
        method: "PUT",
        body: JSON.stringify(changes),
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
    setConfirmDelete(false);
    setDeleting(true);
    try {
      const headers = { 'Content-Type': 'application/json', ...(localStorage.token ? { Authorization: `Bearer ${localStorage.token}` } : {}) };
      const resp = await fetch(`${api}/participants/${selected}`, { method: 'DELETE', headers });
      const d = await resp.json().catch(() => ({}));
      if (resp.status === 401) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        window.dispatchEvent(new Event("auth-expired"));
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
    } finally {
      setDeleting(false);
    }
  };
  const searchQuery = query.trim().toLocaleLowerCase();
  const visibleParticipants = educationFilter === "all"
    ? list
    : list.filter((item) => item.education_level === educationFilter);
  const genderVisibleParticipants = genderFilter === "all"
    ? visibleParticipants
    : visibleParticipants.filter((item) => String(item.gender || "").toLowerCase() === genderFilter);
  const recordStatusParticipants = recordStatusFilter === "all"
    ? genderVisibleParticipants
    : genderVisibleParticipants.filter((item) => String(item.status || "").toLowerCase() === recordStatusFilter);
  const statusVisibleParticipants = childStatusFilter === "all"
    ? recordStatusParticipants
    : recordStatusParticipants.filter((item) =>
        normalizeParticipationStatus(item.participation_status) === childStatusFilter);
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
        t={isGoer ? "My Participants" : "Participant directory."}
        d={isGoer
          ? "View the children assigned to your group."
          : "Explore participant records, review activity history, and monitor sponsored-child participation."}
      />
      {canCreateImport && (
        <div className="participant-register-action d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-dark" onClick={() => setShowRegistration(true)}>
            + Register Child
          </button>
          <button type="button" className="btn btn-outline-primary" onClick={() => setShowImport(true)}>
            Import Data
          </button>
        </div>
      )}
      <section className="participant-gender-summary" aria-label="Participant gender totals">
        <article className="surface"><small>Total participants</small><strong>{list.length}</strong></article>
        <article className="surface"><small>Male</small><strong>{list.filter((item) => String(item.gender || "").toLowerCase() === "male").length}</strong></article>
        <article className="surface"><small>Female</small><strong>{list.filter((item) => String(item.gender || "").toLowerCase() === "female").length}</strong></article>
      </section>
      <div className="row g-4">
        <div className="col-12">
          <div className="surface directory-panel participant-directory-panel">
            <div className="participant-directory-toolbar">
              <input
                className="form-control"
                type="search"
                aria-label="Search participants by full name"
                placeholder="Search"
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
              <div className="participant-filter-field">
                <label className="form-label" htmlFor="participants-gender">Gender</label>
                <select id="participants-gender" className="form-select" value={genderFilter} onChange={(event) => setGenderFilter(event.target.value)}>
                  <option value="all">All</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <div className="participant-filter-field">
                <label className="form-label" htmlFor="participants-record-status">Status</label>
                <select
                  id="participants-record-status"
                  className="form-select"
                  value={recordStatusFilter}
                  onChange={(event) => setRecordStatusFilter(event.target.value)}
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              {canViewSponsorship && (
                <div className="participant-filter-field">
                  <label className="form-label" htmlFor="participants-child-status">Participation status</label>
                  <select
                    id="participants-child-status"
                    className="form-select"
                    value={childStatusFilter}
                    onChange={(event) => setChildStatusFilter(event.target.value)}
                  >
                    <option value="all">All statuses</option>
                    {PARTICIPATION_STATUSES.map(({ value, label }) => (
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
              <article
                className={`directory-row ${selected === item.id ? "selected" : ""}`}
                key={item.id}
              >
                <button type="button" className="directory-row-main" onClick={() => choose(item.id)}>
                  <span>
                    <strong>{item.fullName || "Unnamed participant"}</strong>
                    <small>
                      {item.gender || "Sex not set"}
                      {Number.isFinite(item.age) ? ` · ${item.age} years old` : ""}
                      {" · "}{participantHistoryStatusLabel(item.status)}
                    </small>
                    <small>{item.participant_code || `Participant #${item.id}`}</small>
                    {canViewSponsorship && item.participant_type === "sponsored_child" && (
                      <small className="participant-attendance-summary">
                        Monthly: {item.monthly_participation?.attended || 0}/2 attended · {item.monthly_participation?.absent ?? 2} absent
                      </small>
                    )}
                  </span>
                  {canViewSponsorship && item.participant_type === "sponsored_child" && (
                    <span className={`participation-status-badge ${String(item.participation_status || "ACTIVE").toLowerCase().replaceAll("_", "-")}`}>
                      {participationStatusLabel(item.participation_status)}
                    </span>
                  )}
                </button>
                <div className="participant-row-actions">
                  <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => choose(item.id)}>View</button>
                  {canEdit && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => choose(item.id, true)}>Edit</button>}
                  {canDelete && (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger"
                      onClick={async () => {
                        if (await choose(item.id)) setConfirmDelete(true);
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </article>
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
              <header className="profile-card-header">
                <div className="profile-card-id">
                  <span className="eyebrow">DIGITAL PARTICIPANT ID</span>
                  <h2 id="participant-profile-title">{form.fullName}</h2>
                  <p className="text-secondary mb-0">
                    {form.participantType === "sponsored_child"
                      ? `Sponsored Child · ${participationStatusLabel(form.participation_status)}`
                      : `Goer · ${form.status}`}
                  </p>
                  <p className="text-secondary mt-2 mb-0">{form.participant_code} · <AgeValue dateOfBirth={form.dateOfBirth} /></p>
                </div>
                <div className="profile-card-tools">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onViewHistory(selected)}
                  >
                    View History
                  </button>
                  {canEdit && (
                    <button type="button" className="profile-tool-btn" title="Edit details" aria-label="Edit participant details" onClick={() => { setMessage(""); setEditing(true); }}>
                      <EditIcon />
                    </button>
                  )}
                  {canDelete && (
                    <button type="button" className="profile-tool-btn profile-tool-btn-danger" title="Delete participant" aria-label="Delete participant" onClick={() => setConfirmDelete(true)}>
                      <DeleteIcon />
                    </button>
                  )}
                  <button type="button" className="btn-close" aria-label="Close participant profile" onClick={closeProfile} />
                </div>
              </header>
              {form.participantType === "sponsored_child" && (
                <div className="participant-qr-stage">
                  {form.qr_code_image ? (
                    <img className="participant-qr-image" src={`/${form.qr_code_image}`} alt={`QR code for ${form.participant_code}`} />
                  ) : (
                    <p className="text-secondary mb-0">No active QR code found.</p>
                  )}
                  {form.qr_code_image && (
                    <button type="button" className="btn btn-dark btn-print" onClick={() => window.print()}>
                      <PrintIcon /> Print QR card
                    </button>
                  )}
                </div>
              )}
              {message && <div className="alert alert-info mt-3 mb-0" role="status">{message}</div>}
              {canViewSponsorship && form.participantType === "sponsored_child" && (
                <div className="profile-grid mt-4">
                  <div><small>Participation status</small><strong>{participationStatusLabel(form.participation_status)}</strong></div>
                  <div><small>Monthly activities attended</small><strong>{form.monthly_participation?.attended || 0} / 2</strong></div>
                  <div><small>Monthly absences</small><strong>{form.monthly_participation?.absent ?? 2}</strong></div>
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
                    ["Sponsorship registered", formatParticipantHistoryDate(form.sponsorshipRegistrationDate || form.sponsorship_registered_at)],
                    ["Phone", form.phone],
                    ["Address", form.address],
                    ["Guardian Name", form.emergencyContactName],
                    ["Emergency phone", form.emergencyContactPhone],
                    ["Medical conditions", form.medicalConditions],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <small>{label}</small>
                      <strong>{value || "Not provided"}</strong>
                    </div>
                  ))}
              </div>
              <section className="participant-profile-education">
                <h3>Current Education</h3>
                <div className="profile-grid">
                  {[
                    ["Education level", form.educationLevel],
                    ["Current school", form.schoolName],
                    ["School address", form.schoolAddress],
                    ["Grade / year level", form.gradeLevel],
                    ["College course", form.programCourse],
                  ].map(([label, value]) => (
                    <div key={label}><small>{label}</small><strong>{value || "Not provided"}</strong></div>
                  ))}
                </div>
              </section>
              <section className="participant-profile-education">
                <div className="d-flex justify-content-between align-items-start gap-2">
                  <div>
                    <h3>Education History</h3>
                    <p className="text-secondary">View the schools and education levels previously attended by the participant.</p>
                  </div>
                  {canEdit && <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => setAddingEducation((value) => !value)}>+ Add Education History</button>}
                </div>
                {educationHistory.length ? (
                  <div className="participant-education-history-list">
                    {educationHistory.map((record) => (
                      <article className="participant-education-history-card" key={record.id}>
                        <strong>{record.educationLevel}</strong>
                        <span>{record.schoolName}</span>
                        {record.schoolAddress && <small>{record.schoolAddress}</small>}
                        <span>{record.startYear} – {record.endYear || (record.status === "Currently Attending" ? "Present" : "End year not recorded")}</span>
                        <span>{record.status}</span>
                        {record.courseStrand && <small>{record.courseStrand}</small>}
                        {record.notes && <small>{record.notes}</small>}
                      </article>
                    ))}
                  </div>
                ) : <p className="text-secondary">No education history has been recorded.</p>}
                {addingEducation && canEdit && (
                  <form className="row g-3 mt-2" onSubmit={saveEducationRecord}>
                    <div className="col-12 col-md-6">
                      <label className="form-label" htmlFor="education-history-level">Education level *</label>
                      <select id="education-history-level" className="form-select" required value={educationDraft.educationLevel} onChange={(event) => setEducationDraft({ ...educationDraft, educationLevel: event.target.value })}>
                        <option value="">Select education level</option>
                        {["Elementary", "Junior High School", "Senior High School", "College", "Vocational", "Other"].map((level) => <option key={level}>{level}</option>)}
                      </select>
                    </div>
                    <Field label="School name *" value={educationDraft.schoolName} onChange={(event) => setEducationDraft({ ...educationDraft, schoolName: event.target.value })} required />
                    <Field label="School address" value={educationDraft.schoolAddress} onChange={(event) => setEducationDraft({ ...educationDraft, schoolAddress: event.target.value })} />
                    <Field label="Start year *" type="number" min="1900" max={new Date().getFullYear() + 1} value={educationDraft.startYear} onChange={(event) => setEducationDraft({ ...educationDraft, startYear: event.target.value })} required />
                    <Field label="End year" type="number" min={educationDraft.startYear || "1900"} max={new Date().getFullYear() + 1} value={educationDraft.endYear} onChange={(event) => setEducationDraft({ ...educationDraft, endYear: event.target.value })} required={["Graduated", "Completed"].includes(educationDraft.status)} />
                    <div className="col-12 col-md-6">
                      <label className="form-label" htmlFor="education-history-status">Status *</label>
                      <select id="education-history-status" className="form-select" required value={educationDraft.status} onChange={(event) => setEducationDraft({ ...educationDraft, status: event.target.value })}>
                        <option value="">Select status</option>
                        {["Currently Attending", "Graduated", "Completed", "Transferred", "Dropped", "Other"].map((status) => <option key={status}>{status}</option>)}
                      </select>
                    </div>
                    <Field label="Course / Strand" value={educationDraft.courseStrand} onChange={(event) => setEducationDraft({ ...educationDraft, courseStrand: event.target.value })} />
                    <div className="col-12">
                      <label className="form-label" htmlFor="education-history-notes">Notes</label>
                      <textarea id="education-history-notes" className="form-control" rows="2" maxLength="2000" value={educationDraft.notes} onChange={(event) => setEducationDraft({ ...educationDraft, notes: event.target.value })} />
                    </div>
                    <div className="col-12 d-flex gap-2">
                      <button type="submit" className="btn btn-primary btn-sm">Save education record</button>
                      <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setAddingEducation(false)}>Cancel</button>
                    </div>
                  </form>
                )}
              </section>
              {canViewSponsorship && form.participantType === "sponsored_child" && (
                <section className="participant-profile-education">
                  <h3>Growth &amp; Activity</h3>
                  {growthUpdates.length ? (
                    <div className="guardian-update-list">
                      {growthUpdates.map((updateEntry) => (
                        <article className={`guardian-update-card update-${updateEntry.type}`} key={updateEntry.id}>
                          <div className="guardian-update-body">
                            <div className="guardian-update-top">
                              <strong>{updateEntry.type === "growth" ? "Growth measurement" : updateEntry.type === "activity" ? "Activity" : "Care note"}</strong>
                              <time>{formatParticipantHistoryDate(updateEntry.recordedOn)}</time>
                            </div>
                            {updateEntry.type === "growth" && (updateEntry.heightCm || updateEntry.weightKg) && (
                              <p className="guardian-update-metrics">
                                {updateEntry.heightCm && <span>Height: {updateEntry.heightCm} cm</span>}
                                {updateEntry.weightKg && <span>Weight: {updateEntry.weightKg} kg</span>}
                              </p>
                            )}
                            {updateEntry.activity && <p className="guardian-update-activity">{updateEntry.activity}</p>}
                            {updateEntry.note && <p className="guardian-update-note">{updateEntry.note}</p>}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : <p className="text-secondary">No Growth &amp; Activity updates recorded yet.</p>}
                </section>
              )}
              <section className="participant-profile-education">
                <h3>Attendance</h3>
                <p className="text-secondary">Detailed attendance is calculated from existing events and check-in records.</p>
                <h4>Weekly Attendance — Current Month</h4>
                {profileAttendance?.currentMonthWeeklyAttendance?.length ? (
                  <ul className="participation-event-history">
                    {profileAttendance.currentMonthWeeklyAttendance.map((week) => (
                      <li key={week.week}>
                        <span className={week.totalAttended ? "attendance-check" : "attendance-missed"}>{week.totalAttended ? "✓" : "×"}</span>
                        <div><strong>Week {week.week}</strong><small>{week.totalAttended}/{week.totalEvents} attended · {week.totalEvents - week.totalAttended} absent</small></div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-secondary">No events recorded this month.</p>}
                <h4>Monthly Attendance</h4>
                {profileAttendance?.attendanceByMonth?.length ? (
                  <div className="table-responsive"><table className="table table-sm">
                    <thead><tr><th>Month</th><th>Attended / Events</th><th>Attendance</th></tr></thead>
                    <tbody>{profileAttendance.attendanceByMonth.map((month) => (
                      <tr key={month.month}>
                        <td>{new Date(2000, month.month - 1, 1).toLocaleDateString(undefined, { month: "long" })}</td>
                        <td>{month.totalAttended}/{month.totalEvents}</td>
                        <td>{month.attendanceRate}%</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                ) : <p className="text-secondary">No monthly attendance is available.</p>}
                <h4>Yearly Attendance</h4>
                {profileAttendance?.attendanceByYear?.length ? (
                  <div className="table-responsive"><table className="table table-sm">
                    <thead><tr><th>Year</th><th>Attended</th><th>Absent</th><th>Attendance</th></tr></thead>
                    <tbody>{profileAttendance.attendanceByYear.map((year) => (
                      <tr key={year.year}><td>{year.year}</td><td>{year.totalAttended}</td><td>{year.totalEvents - year.totalAttended}</td><td>{year.attendanceRate}%</td></tr>
                    ))}</tbody>
                  </table></div>
                ) : <p className="text-secondary">No yearly attendance is available.</p>}
                <h4>Historical Attendance Summary (Imported)</h4>
                <p className="text-secondary">Summary-only imports are separate from detailed attendance and do not affect participation status.</p>
                {profileAttendance?.historicalAttendanceSummary?.length ? (
                  <div className="table-responsive"><table className="table table-sm">
                    <thead><tr><th>Year</th><th>Required</th><th>Attended</th><th>Absent</th></tr></thead>
                    <tbody>{profileAttendance.historicalAttendanceSummary.map((summary) => (
                      <tr key={summary.year}><td>{summary.year}</td><td>{summary.required}</td><td>{summary.attended}</td><td>{summary.absent}</td></tr>
                    ))}</tbody>
                  </table></div>
                ) : <p className="text-secondary">No historical summary imported.</p>}
              </section>
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
              {form.participantType === "goer" && canDelete && (
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
                      label="Guardian Name"
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
                    {form.participantType === "sponsored_child" && (
                      <Field
                        label="Sponsorship registration date"
                        type="date"
                        value={(form.sponsorshipRegistrationDate || form.sponsorship_registered_at || "").slice(0, 10)}
                        onChange={update("sponsorshipRegistrationDate")}
                      />
                    )}
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
      {confirmDelete && canDelete && createPortal(
        <div
          className="participant-modal-backdrop confirm-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleting) setConfirmDelete(false);
          }}
        >
          <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-delete-title" aria-describedby="confirm-delete-desc">
            <span className="confirm-icon" aria-hidden="true">
              <DeleteIcon />
            </span>
            <h2 id="confirm-delete-title">Delete participant?</h2>
            <p id="confirm-delete-desc">
              This will revoke the QR code for <strong>{form?.fullName || form?.participant_code || "this participant"}</strong> and mark the record as deleted. This action cannot be undone.
            </p>
            <div className="confirm-actions">
              <button type="button" className="btn btn-light" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={deleteParticipant} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete participant"}
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}
      {showRegistration && canCreateImport && (
        <Register
          onClose={() => setShowRegistration(false)}
          onCreated={refreshParticipants}
        />
      )}
      {showImport && canCreateImport && <ImportDataModal onClose={() => setShowImport(false)} onCompleted={refreshParticipants} />}
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
          <span>View your child’s progress, attendance, and care updates with their QR code and passcode.</span>
          <b>View child progress <span aria-hidden="true">↗</span></b>
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
        <p>View your child’s participation, attendance, growth, and current care status.</p>
        <p className="guardian-verification-hint">Scan the Sponsored Child QR code. You’ll be asked for the passcode after scanning.</p>
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
          <div className="guardian-child-profile">
            <span className="guardian-child-avatar" aria-hidden="true">
              {result.child.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}
            </span>
            <div className="guardian-child-identity">
              <span className="eyebrow">VERIFIED CHILD</span>
              <h2>{result.child.name}</h2>
              <p>Participant ID: {result.child.participantCode || "Not recorded"} · {result.child.age ?? "Age not recorded"} years old · {result.child.gender || "Sex not recorded"}</p>
            </div>
          </div>
          <GuardianSponsoredDetails
            child={result.child}
            qrPayload={payload}
            passcode={passcode}
          />
          <button className="btn btn-outline-dark mt-4 guardian-look-up-button" onClick={() => { setResult(null); setPasscode(""); setPayload(""); setPasscodeOpen(false); lastScannedPayload.current = ""; lastScannedAt.current = 0; }}>Look up another child</button>
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
  const [section, setSection] = useState("attendance");
  const [attendanceView, setAttendanceView] = useState("monthly");
  const [selectedMonth, setSelectedMonth] = useState(child.participation?.monthly?.key || "");
  const [selectedYear, setSelectedYear] = useState(String(child.participation?.currentYear?.year || new Date().getFullYear()));
  const [showAllMonths, setShowAllMonths] = useState(false);
  const [updates, setUpdates] = useState([]);
  const [loadingUpdates, setLoadingUpdates] = useState(false);
  const [updatesLoaded, setUpdatesLoaded] = useState(false);
  const [error, setError] = useState("");
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
      if (!response.ok) throw new Error(data.error || "Could not load your child's growth updates.");
      setUpdates(data.updates || []);
      setUpdatesLoaded(true);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoadingUpdates(false);
    }
  };
  const participation = child.participation;
  const months = participation?.months || [];
  const monthly = participation?.monthly;
  const monthlyComplete = Boolean(monthly?.required > 0 && monthly.attended >= monthly.required);
  const status = participation?.status || "WARNING";
  const statusClass = status.toLowerCase().replaceAll("_", "-");
  const statusDetails = {
    ACTIVE: {
      label: "Good standing",
      badge: "✓ GOOD STANDING",
      message: "Your child is currently meeting the monthly participation requirement.",
      icon: "✓",
    },
    WARNING: {
      label: "Attendance warning",
      badge: "⚠ ATTENDANCE WARNING",
      message: `Your child currently has ${monthly?.absent ?? 0} recorded ${monthly?.absent === 1 ? "absence" : "absences"} for ${monthly?.key || "this month"}.`,
      icon: "⚠",
    },
    SECOND_CHANCE: {
      label: "Second chance",
      badge: "↻ SECOND CHANCE",
      message: "Your child is currently under a second-chance attendance period.",
      icon: "↻",
    },
    GROUNDS_FOR_DEPARTURE: {
      label: "Grounds for departure",
      badge: "! GROUNDS FOR DEPARTURE",
      message: "Your child has reached the attendance threshold. Please contact the program administrator for further information.",
      icon: "!",
    },
    REMOVED_FROM_SPONSORSHIP: {
      label: "Program status ended",
      badge: "PROGRAM STATUS ENDED",
      message: "Please contact the program administrator if you have questions about your child's current program status.",
      icon: "!",
    },
  }[status] || {
    label: "Attendance warning",
    badge: "⚠ ATTENDANCE WARNING",
    message: "Please contact the program administrator for information about your child's current status.",
    icon: "⚠",
  };
  const selectedMonthSummary = months.find((month) => month.key === selectedMonth) || monthly;
  const selectedYearSummary = (participation?.years || []).find((year) => String(year.year) === selectedYear)
    || participation?.currentYear;
  const yearMonths = months.filter((month) => String(month.year) === String(selectedYear));
  const activities = months.flatMap((month) => month.events || [])
    .sort((first, second) => String(second.date).localeCompare(String(first.date)));
  const lastAttendedActivity = activities.find((activity) => activity.attended);
  const now = new Date();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekStartKey = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}-${String(weekStart.getDate()).padStart(2, "0")}`;
  const weekEndKey = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, "0")}-${String(weekEnd.getDate()).padStart(2, "0")}`;
  const weekActivities = activities.filter((activity) => activity.date >= weekStartKey && activity.date <= weekEndKey);
  const weekAttended = weekActivities.filter((activity) => activity.attended).length;
  const weekAbsent = weekActivities.length - weekAttended;
  const weekRate = weekActivities.length ? Math.round((weekAttended / weekActivities.length) * 1000) / 10 : 0;
  const monthLabel = (key) => key
    ? formatParticipantHistoryDate(`${key}-01`, { month: "long", year: "numeric" })
    : "Current month";
  const activityStats = (entry) => [
    ["Required", entry?.required ?? 0],
    ["Attended", entry?.attended ?? 0],
    ["Absent", entry?.absent ?? 0],
    ["Attendance rate", `${entry?.attendanceRate ?? 0}%`],
  ];
  const statusForMonth = (month) => month.status === "ACTIVE"
    ? { label: "Good standing", icon: "✓", className: "active" }
    : { label: "Warning", icon: "⚠", className: "warning" };
  const statusHistory = [
    ...months.map((month) => ({
      key: `month-${month.key}`,
      date: `${month.key}-01`,
      label: statusForMonth(month).label,
      icon: statusForMonth(month).icon,
      className: statusForMonth(month).className,
      description: month.status === "ACTIVE"
        ? "Monthly participation requirement completed."
        : `${month.absent} ${month.absent === 1 ? "absence" : "absences"} recorded for the month.`,
    })),
    ...(participation?.history || [])
      .filter((entry) => ["grounds_for_departure", "second_chance", "removed"].includes(entry.type))
      .map((entry, index) => {
        const typeInfo = {
          grounds_for_departure: {
            label: "Grounds for departure",
            icon: "!",
            className: "grounds-for-departure",
            description: entry.reason || `${entry.absenceCount} total absences reached the program threshold.`,
          },
          second_chance: {
            label: "Second chance",
            icon: "↻",
            className: "second-chance",
            description: entry.reason || "Second-chance attendance monitoring started.",
          },
          removed: {
            label: "Program status ended",
            icon: "!",
            className: "removed-from-sponsorship",
            description: entry.reason || "A program status decision was recorded.",
          },
        }[entry.type];
        return {
          key: `action-${entry.type}-${index}`,
          date: entry.createdAt,
          ...typeInfo,
        };
      }),
  ].sort((first, second) => String(second.date).localeCompare(String(first.date)));

  return (
    <div className="guardian-sponsored-details">
      <section className={`guardian-current-status guardian-status-${statusClass}`} aria-label="Current child status">
        <div className="guardian-current-status-icon" aria-hidden="true">{statusDetails.icon}</div>
        <div>
          <span>CURRENT STATUS</span>
          <strong>{statusDetails.badge}</strong>
          <p>{statusDetails.message}</p>
        </div>
      </section>
      <section className="guardian-overview-section">
        <div className="guardian-section-heading">
          <span className="eyebrow">CHILD OVERVIEW</span>
          <h3>At a glance</h3>
        </div>
        <div className="guardian-overview-grid">
          {[
            ["Current status", statusDetails.label],
            ["This month", `${monthly?.attended ?? 0} / ${monthly?.required ?? 0}`],
            ["Attendance rate", `${monthly?.attendanceRate ?? 0}%`],
            ["Total absences", participation?.lifetime?.absent ?? 0],
            ["Last activity", lastAttendedActivity
              ? `${lastAttendedActivity.name} · ${formatParticipantHistoryDate(lastAttendedActivity.date, { month: "short", day: "numeric" })}`
              : "No attendance yet"],
          ].map(([label, value]) => (
            <article key={label}><span>{label}</span><strong>{value}</strong></article>
          ))}
        </div>
      </section>
      <div className="guardian-portal-tabs" role="tablist" aria-label="Child participation information">
        <button type="button" className={section === "attendance" ? "active" : ""} role="tab" aria-selected={section === "attendance"} onClick={() => setSection("attendance")}>Attendance</button>
        <button type="button" className={section === "updates" ? "active" : ""} role="tab" aria-selected={section === "updates"} onClick={() => { setSection("updates"); loadUpdates(); }}>Growth &amp; development</button>
        {(child.educationLevel || child.gradeLevel || child.educationHistory?.length) && <button type="button" className={section === "education" ? "active" : ""} role="tab" aria-selected={section === "education"} onClick={() => setSection("education")}>Education</button>}
      </div>
      {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      {section === "attendance" ? (
        <div className="guardian-updates-section">
          <section className="guardian-dashboard-card guardian-monthly-card">
            <div className="guardian-section-heading">
              <div><span className="eyebrow">MONTHLY PARTICIPATION</span><h3>{monthLabel(monthly?.key)}</h3></div>
              <span className={`guardian-status-chip guardian-status-chip-${statusClass}`}>{statusDetails.label}</span>
            </div>
            <div className="guardian-stat-grid">
              {activityStats(monthly).map(([label, value]) => (
                <article key={label}><span>{label}</span><strong>{value}</strong></article>
              ))}
            </div>
            <div className="guardian-progress-copy"><strong>{monthly?.attended ?? 0} / {monthly?.required ?? 0} activities completed</strong><span>{monthly?.attendanceRate ?? 0}%</span></div>
            <div className="guardian-progress-track" role="progressbar" aria-label="Monthly activities completed" aria-valuemin="0" aria-valuemax={monthly?.required ?? 0} aria-valuenow={monthly?.attended ?? 0}>
              <span style={{ width: `${monthly?.required ? Math.min(100, (monthly.attended / monthly.required) * 100) : 0}%` }} />
            </div>
            <p className={`guardian-requirement-message ${monthlyComplete ? "complete" : "incomplete"}`}>
              <strong>{monthlyComplete ? "✓ Monthly requirement completed" : "⚠ Monthly requirement not completed"}</strong>
              <span>{monthlyComplete
                ? `Your child attended the required ${monthly?.required} activities this month.`
                : `Your child needs to attend ${Math.max(0, (monthly?.required ?? 0) - (monthly?.attended ?? 0))} more ${Math.max(0, (monthly?.required ?? 0) - (monthly?.attended ?? 0)) === 1 ? "activity" : "activities"} to meet this month's requirement.`}</span>
            </p>
            {(monthly?.absent ?? 0) > 0 && <p className="guardian-absence-note">Your child has {monthly.absent} recorded {monthly.absent === 1 ? "absence" : "absences"} this month.</p>}
          </section>

          <section className="guardian-dashboard-card">
            <div className="guardian-history-heading">
              <div><span className="eyebrow">ATTENDANCE HISTORY</span><h3>Review attendance</h3></div>
              <label className="guardian-view-select">
                <span className="visually-hidden">Attendance history view</span>
                <select className="form-select" value={attendanceView} onChange={(event) => setAttendanceView(event.target.value)}>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>
            </div>
            {attendanceView === "weekly" && (
              <div className="guardian-history-view">
                <h4>Weekly attendance</h4>
                <p className="guardian-period-label">{formatParticipantHistoryDate(weekStartKey, { month: "long", day: "numeric" })} – {formatParticipantHistoryDate(weekEndKey, { month: "long", day: "numeric", year: "numeric" })}</p>
                <div className="guardian-stat-grid guardian-stat-grid-compact">
                  {[["Activities held", weekActivities.length], ["Attended", weekAttended], ["Missed", weekAbsent], ["Attendance rate", `${weekRate}%`]].map(([label, value]) => (
                    <article key={label}><span>{label}</span><strong>{value}</strong></article>
                  ))}
                </div>
                <GuardianActivityList activities={weekActivities} emptyMessage="No event attendance records for this week." />
              </div>
            )}
            {attendanceView === "monthly" && (
              <div className="guardian-history-view">
                <label className="guardian-period-select"><span>Choose month</span>
                  <select className="form-select" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
                    {months.map((month) => <option key={month.key} value={month.key}>{monthLabel(month.key)}</option>)}
                  </select>
                </label>
                <h4>{monthLabel(selectedMonthSummary?.key)}</h4>
                <div className="guardian-stat-grid guardian-stat-grid-compact">
                  {activityStats(selectedMonthSummary).map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
                </div>
                <div className="guardian-month-history">
                  <h4>Monthly summary</h4>
                  {(showAllMonths ? months : months.slice(0, 12)).map((month) => {
                    const monthStatus = statusForMonth(month);
                    return (
                      <article className="guardian-month-row" key={month.key}>
                        <strong>{monthLabel(month.key)}</strong>
                        <span>{month.required} required</span>
                        <span>{month.attended} attended · {month.absent} absent</span>
                        <strong>{month.attendanceRate}%</strong>
                        <span className={`guardian-history-status ${monthStatus.className}`}>{monthStatus.icon} {monthStatus.label}</span>
                      </article>
                    );
                  })}
                  {months.length > 12 && <button type="button" className="guardian-show-older-button" onClick={() => setShowAllMonths((shown) => !shown)}>{showAllMonths ? "Show recent months" : "Show older months"}</button>}
                </div>
                <h4 className="guardian-subsection-title">Recent activity attendance</h4>
                <GuardianActivityList activities={activities.slice(0, 30)} emptyMessage="No event attendance records found." />
              </div>
            )}
            {attendanceView === "yearly" && (
              <div className="guardian-history-view">
                <label className="guardian-period-select"><span>Choose year</span>
                  <select className="form-select" value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)}>
                    {(participation?.years || []).map((year) => <option key={year.year} value={year.year}>{year.year}</option>)}
                  </select>
                </label>
                <h4>{selectedYear} attendance summary</h4>
                <div className="guardian-stat-grid guardian-stat-grid-compact">
                  {[["Required activities", selectedYearSummary?.required ?? 0], ["Attended", selectedYearSummary?.attended ?? 0], ["Absent", selectedYearSummary?.absent ?? 0], ["Attendance rate", `${selectedYearSummary?.attendanceRate ?? 0}%`]].map(([label, value]) => (
                    <article key={label}><span>{label}</span><strong>{value}</strong></article>
                  ))}
                </div>
                <div className="guardian-month-history">
                  {yearMonths.map((month) => {
                    const monthStatus = statusForMonth(month);
                    return (
                      <article className="guardian-year-month-row" key={month.key}>
                        <strong>{monthLabel(month.key)}</strong>
                        <span>{month.attended} / {month.required}</span>
                        <span>{month.attendanceRate}%</span>
                        <span className={`guardian-history-status ${monthStatus.className}`}>{monthStatus.icon} {monthStatus.label}</span>
                      </article>
                    );
                  })}
                  {!yearMonths.length && <p className="text-secondary">No monthly attendance records found for this year.</p>}
                </div>
                <h4 className="guardian-subsection-title">Recent activity attendance</h4>
                <GuardianActivityList activities={activities.filter((activity) => String(activity.date).startsWith(`${selectedYear}-`)).slice(0, 30)} emptyMessage="No event attendance records found for this year." />
              </div>
            )}
          </section>

          <section className="guardian-dashboard-card">
            <div className="guardian-section-heading"><span className="eyebrow">ATTENDANCE OVERVIEW</span><h3>Participation to date</h3></div>
            <div className="guardian-overview-grid guardian-overview-grid-three">
              {[
                ["Current month absences", monthly?.absent ?? 0],
                ["Total absences", participation?.lifetime?.absent ?? 0],
                ["Overall attendance rate", `${participation?.lifetime?.attendanceRate ?? 0}%`],
              ].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
            </div>
            <p className="guardian-threshold-note">Six absences may result in Grounds for Departure, subject to the program’s second-chance policy. Final decisions are made by an authorized administrator.</p>
          </section>

          <section className="guardian-dashboard-card">
            <div className="guardian-section-heading"><span className="eyebrow">STATUS HISTORY</span><h3>How participation has changed</h3></div>
            {statusHistory.length ? (
              <ul className="guardian-status-history">
                {statusHistory.slice(0, 12).map((entry) => (
                  <li key={entry.key}>
                    <span className={`guardian-history-icon ${entry.className}`} aria-hidden="true">{entry.icon}</span>
                    <div><strong>{entry.label}</strong><span>{formatParticipantHistoryDate(entry.date, { month: "long", year: "numeric" })}</span><p>{entry.description}</p></div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-secondary mb-0">No status history is available yet.</p>}
          </section>
        </div>
      ) : section === "updates" ? (
        <section className="guardian-updates-section">
          <div className="guardian-section-heading"><span className="eyebrow">GROWTH &amp; DEVELOPMENT</span><h3>Growth updates</h3></div>
          <p className="guardian-read-only-note">These records are view-only and are shared by your child’s care team.</p>
          {loadingUpdates ? <p role="status">Loading updates...</p> : updates.length ? (
            <>
              <div className="guardian-latest-update">
                <span className="eyebrow">LATEST UPDATE</span>
                <GuardianUpdateCard update={updates[0]} />
              </div>
              {updates.length > 1 && <div className="guardian-previous-updates">
                <h4>Previous updates</h4>
                <div className="guardian-update-list">
                  {updates.slice(1).map((update) => <GuardianUpdateCard key={update.id} update={update} />)}
                </div>
              </div>}
            </>
          ) : <p className="text-secondary">No growth updates recorded yet.</p>}
        </section>
      ) : (
        <section className="guardian-updates-section">
          <div className="guardian-section-heading"><span className="eyebrow">EDUCATION</span><h3>Education information</h3></div>
          <div className="guardian-education-card">
            <span>Current education</span>
            <strong>{[child.educationLevel, child.gradeLevel].filter(Boolean).join(" · ") || "Not recorded"}</strong>
            {child.schoolName && <span>{child.schoolName}</span>}
          </div>
          {child.educationHistory?.length ? <div className="guardian-education-history">
            {child.educationHistory.map((record, index) => (
              <article key={`${record.educationLevel}-${record.startYear}-${index}`}>
                <strong>{record.educationLevel}{record.courseStrand ? ` · ${record.courseStrand}` : ""}</strong>
                <span>{record.schoolName || "School not recorded"} · {record.startYear}{record.endYear ? `–${record.endYear}` : "–Present"}</span>
                <small>{record.status}</small>
              </article>
            ))}
          </div> : <p className="text-secondary mb-0">No additional education history is available.</p>}
        </section>
      )}
    </div>
  );
}
function GuardianActivityList({ activities, emptyMessage }) {
  if (!activities.length) return <p className="guardian-empty-history">{emptyMessage}</p>;
  return (
    <ul className="guardian-activity-list">
      {activities.map((activity, index) => (
        <li key={`${activity.name}-${activity.date}-${index}`}>
          <span className={`guardian-activity-mark ${activity.attended ? "attended" : "absent"}`} aria-hidden="true">{activity.attended ? "✓" : "×"}</span>
          <div>
            <strong>{activity.name || "Activity"}</strong>
            <span>{formatParticipantHistoryDate(activity.date)}</span>
          </div>
          <span className={`guardian-activity-label ${activity.attended ? "attended" : "absent"}`}>{activity.attended ? "Attended" : "Absent"}</span>
        </li>
      ))}
    </ul>
  );
}
function GuardianUpdateCard({ update }) {
  return (
    <article className={`guardian-update-card update-${update.type}`}>
      <div className="guardian-update-body">
        <div className="guardian-update-top">
          <strong>{update.type === "growth" ? "Growth update" : update.type === "activity" ? "Activity update" : "Care note"}</strong>
          <time>{formatParticipantHistoryDate(update.recordedOn)}</time>
        </div>
        {update.type === "growth" && (update.heightCm || update.weightKg) && (
          <p className="guardian-update-metrics">
            {update.heightCm && <span className="metric-height">Height: {update.heightCm} cm</span>}
            {update.weightKg && <span className="metric-weight">Weight: {update.weightKg} kg</span>}
          </p>
        )}
        {update.activity && <p className="guardian-update-activity">{update.activity}</p>}
        {update.activity && <p className="guardian-update-activity">{update.activity}</p>}
        {update.note && <p className="guardian-update-note">{update.note}</p>}
      </div>
    </article>
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
              <div><small>Guardian Name</small><strong>{profile.emergencyContactName || "Not provided"}</strong></div>
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
  const [educationLevel, setEducationLevel] = useState("");
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
  const [sponsoredFilters, setSponsoredFilters] = useState({ educationLevel: "", gradeLevel: "", participationStatus: "", riskLevel: "" });
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
    apiCall(`/analytics/overview?from=${from}&to=${to}&educationLevel=${encodeURIComponent(educationLevel)}`)
      .then((data) => { if (mounted) setOverview(data); })
      .catch((fetchError) => { if (mounted) setLoadError(fetchError.message); })
      .finally(() => { if (mounted) setOverviewLoading(false); });
    return () => { mounted = false; };
  }, [from, to, educationLevel]);

  useEffect(() => {
    let mounted = true;
    setTrendsLoading(true);
    apiCall(`/analytics/trends?from=${from}&to=${to}&interval=${trendInterval}&event=${encodeURIComponent(trendEvent)}`)
      .then((data) => {
        if (!mounted) return;
        setTrends(data.records || []);
        setTrendEvents(data.events || []);
      })
      .catch((fetchError) => { if (mounted) setLoadError(fetchError.message); })
      .finally(() => { if (mounted) setTrendsLoading(false); });
    return () => { mounted = false; };
  }, [from, to, trendInterval, trendEvent]);

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
      ...(canViewSponsorship ? [apiCall(`/analytics/sponsored-children?educationLevel=${encodeURIComponent(sponsoredFilters.educationLevel)}&gradeLevel=${encodeURIComponent(sponsoredFilters.gradeLevel)}&participationStatus=${encodeURIComponent(sponsoredFilters.participationStatus)}&riskLevel=${sponsoredFilters.riskLevel}`)] : []),
    ])
      .then(([validationReport, sponsored]) => {
        if (!mounted) return;
        setValidation(validationReport);
        if (canViewSponsorship && sponsored) setSponsoredRows(sponsored.records || []);
      })
      .catch((fetchError) => { if (mounted) setLoadError(fetchError.message); })
      .finally(() => { if (mounted) setSponsoredLoading(false); });
    return () => { mounted = false; };
  }, [canViewSponsorship, sponsoredFilters.educationLevel, sponsoredFilters.gradeLevel, sponsoredFilters.participationStatus, sponsoredFilters.riskLevel]);

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
          { label: "Elementary", data: trends.map((row) => row.elementaryCheckIns), borderColor: "#2e7dd5", backgroundColor: "rgba(46,125,213,.12)", fill: false, tension: 0.4, borderWidth: 2, pointRadius: 3 },
          { label: "Junior High School", data: trends.map((row) => row.juniorHighSchoolCheckIns), borderColor: "#16a34a", backgroundColor: "rgba(22,163,74,.12)", fill: false, tension: 0.4, borderWidth: 2, pointRadius: 3 },
          { label: "Senior High School", data: trends.map((row) => row.seniorHighSchoolCheckIns), borderColor: "#ca8a04", backgroundColor: "rgba(202,138,4,.12)", fill: false, tension: 0.4, borderWidth: 2, pointRadius: 3 },
          { label: "College", data: trends.map((row) => row.collegeCheckIns), borderColor: "#9333ea", backgroundColor: "rgba(147,51,234,.12)", fill: false, tension: 0.4, borderWidth: 2, pointRadius: 3 },
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
  const participationStatusOptions = [["", "Any status"], ...PARTICIPATION_STATUSES.map(({ value, label }) => [value, label])];
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
              <label className="form-label" htmlFor="analytics-education">Education level</label>
              <select id="analytics-education" className="form-select" value={educationLevel} onChange={(event) => setEducationLevel(event.target.value)}>
                <option value="">All education levels</option>
                {EDUCATION_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
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
            <p className="analytics-section-sub">Daily, weekly, monthly, and yearly attendance broken down by education level.</p>
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
              <p className="analytics-section-sub">Monthly activity compliance and yearly absence summaries for each sponsored child.</p>
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
                <label className="form-label" htmlFor="sponsored-status">Participation status</label>
                <select id="sponsored-status" className="form-select" value={sponsoredFilters.participationStatus} onChange={(event) => setSponsoredFilters({ ...sponsoredFilters, participationStatus: event.target.value })}>
                  {participationStatusOptions.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}
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
                    <th>Monthly attendance</th>
                    <th>Attended</th>
                    <th>Absent</th>
                    <th>Yearly absences</th>
                    <th>Current status</th>
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
                      <td>{row.monthly.key}</td>
                      <td>{row.monthly.attended} / {row.monthly.required}</td>
                      <td>{row.monthly.absent}</td>
                      <td>{row.lifetime.absent}</td>
                      <td><span className="status-pill">{PARTICIPATION_STATUS_LABELS[row.participationStatus] || row.participationStatus}</span></td>
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
  const canViewParticipation = canAccessPermission("sponsorship:view", user);
  const [range, setRange] = useState("weekly");
  const [children, setChildren] = useState([]);
  const [loadingParticipation, setLoadingParticipation] = useState(false);
  const [participationError, setParticipationError] = useState("");

  useEffect(() => {
    if (!canViewParticipation) return;
    setLoadingParticipation(true);
    apiCall("/sponsorship/children")
      .then(setChildren)
      .catch((loadError) => setParticipationError(loadError.message))
      .finally(() => setLoadingParticipation(false));
  }, [canViewParticipation]);

  const downloadAttendance = async (format) => {
    const token = localStorage.getItem("token");
    const response = await fetch(
      `${api}/reports/attendance?range=${range}&format=${format}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "Could not export attendance.");
    }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `attendance-${range}.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const downloadParticipation = () => {
    const columns = [
      "Participant", "Participant ID", "Gender", "Current Status",
      "Month", "Required Activities", "Attended", "Absent", "Attendance Rate",
      "Year", "Yearly Required", "Yearly Attended", "Yearly Absences", "Yearly Attendance Rate",
    ];
    const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const data = children.map((child) => [
      child.name, child.participantCode, child.gender,
      PARTICIPATION_STATUS_LABELS[child.status] || child.status,
      child.monthly.key, child.monthly.required, child.monthly.attended,
      child.monthly.absent, `${child.monthly.attendanceRate}%`,
      child.currentYear.year, child.currentYear.required, child.currentYear.attended,
      child.currentYear.absent, `${child.currentYear.attendanceRate}%`,
    ]);
    const csv = [columns, ...data].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "sponsored-child-participation.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Title
        e="REPORTING"
        t="Turn activity into clarity."
        d="Export attendance records and participation-based monthly and yearly sponsored-child reports."
      />
      <div className="surface report-panel">
        <label className="form-label">Reporting range</label>
        <select className="form-select mb-3" value={range} onChange={(event) => setRange(event.target.value)}>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        <button className="btn btn-dark me-2" onClick={() => downloadAttendance("pdf")}>Download PDF ↓</button>
        <button className="btn btn-outline-dark" onClick={() => downloadAttendance("csv")}>Download CSV ↓</button>
      </div>
      {canViewParticipation && (
        <div className="surface report-panel mt-4">
          <h2>Sponsored-child participation</h2>
          <p>Monthly compliance, yearly attendance, absence counts, and current status.</p>
          {participationError && <div className="alert alert-danger" role="alert">{participationError}</div>}
          <div className="participant-gender-summary">
            <article className="surface"><small>Children monitored</small><strong>{loadingParticipation ? "—" : children.length}</strong></article>
            <article className="surface"><small>Male</small><strong>{children.filter((child) => child.gender.toLowerCase() === "male").length}</strong></article>
            <article className="surface"><small>Female</small><strong>{children.filter((child) => child.gender.toLowerCase() === "female").length}</strong></article>
          </div>
          <div className="table-responsive mt-3">
            <table className="table align-middle">
              <thead><tr><th>Child</th><th>Month</th><th>Required</th><th>Attended</th><th>Absent</th><th>Attendance</th><th>Yearly absences</th><th>Status</th></tr></thead>
              <tbody>{children.map((child) => (
                <tr key={child.id}>
                  <td>{child.name}<small className="d-block text-secondary">{child.participantCode}</small></td>
                  <td>{child.monthly.key}</td><td>{child.monthly.required}</td><td>{child.monthly.attended}</td>
                  <td>{child.monthly.absent}</td><td>{child.monthly.attendanceRate}%</td>
                  <td>{child.currentYear.absent}</td><td>{PARTICIPATION_STATUS_LABELS[child.status] || child.status}</td>
                </tr>
              ))}</tbody>
            </table>
            {!children.length && !loadingParticipation && <p className="text-secondary mb-0">No sponsored children found.</p>}
          </div>
          <button className="btn btn-outline-dark" disabled={!children.length || loadingParticipation} onClick={downloadParticipation}>
            Download participation CSV ↓
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
                const detailText = details.changedFields?.join(", ")
                  || details.eventName
                  || (details.reason ? `${details.reason}${details.absenceCount === undefined ? "" : ` · ${details.absenceCount} absences`}` : "")
                  || (details.absenceCount === undefined ? "—" : `${details.absenceCount} absences`);
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

const PARTICIPATION_STATUS_LABELS = {
  ACTIVE: "Active",
  WARNING: "Warning",
  GROUNDS_FOR_DEPARTURE: "Grounds for Departure",
  SECOND_CHANCE: "Second Chance",
  REMOVED_FROM_SPONSORSHIP: "Removed from program",
};

function SponsoredCare({ user, onViewHistory }) {
  const canManage = canAccessPermission("sponsorship:manage", user);
  const isGoer = String(user?.role || "").toLowerCase() === GOER_ROLE;
  const canRecordCare = isGoer
    ? Array.isArray(user?.permissions) && user.permissions.includes("goer-care:record")
    : canManage;
  const [children, setChildren] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [details, setDetails] = useState(null);
  const [profileTab, setProfileTab] = useState("attendance");
  const [growthUpdates, setGrowthUpdates] = useState([]);
  const [growthUpdatesLoading, setGrowthUpdatesLoading] = useState(false);
  const [growthFormOpen, setGrowthFormOpen] = useState(false);
  const [growthSaving, setGrowthSaving] = useState(false);
  const [growthFormError, setGrowthFormError] = useState("");
  const childDetailsRequest = useRef(0);
  const [growthForm, setGrowthForm] = useState({
    recordedOn: new Date().toLocaleDateString("en-CA"),
    type: "growth",
    activity: "",
    heightCm: "",
    weightKg: "",
    note: "",
  });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("attention");
  const [secondChanceReason, setSecondChanceReason] = useState("");
  const [removalReason, setRemovalReason] = useState("");
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = async () => {
    const rows = await apiCall("/sponsorship/children");
    setChildren(rows);
  };
  useEffect(() => {
    let mounted = true;
    apiCall("/sponsorship/children")
      .then((rows) => { if (mounted) setChildren(rows); })
      .catch((requestError) => { if (mounted) setError(requestError.message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const selectedChild = children.find((child) => Number(child.id) === Number(selectedId));
  const child = details && Number(details.id) === Number(selectedId) ? details : selectedChild;
  const visibleChildren = children
    .filter((entry) =>
      (statusFilter === "all" || entry.status === statusFilter) &&
      `${entry.name} ${entry.participantCode || ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    )
    .sort((first, second) => {
      if (sortBy === "name") return first.name.localeCompare(second.name);
      if (sortBy === "attendance") return second.monthly.attendanceRate - first.monthly.attendanceRate
        || first.name.localeCompare(second.name);
      const priority = { GROUNDS_FOR_DEPARTURE: 0, WARNING: 1, SECOND_CHANCE: 2, ACTIVE: 3 };
      return (priority[first.status] ?? 4) - (priority[second.status] ?? 4)
        || first.name.localeCompare(second.name);
    });
  const statusClass = (status) => String(status || "WARNING").toLowerCase().replaceAll("_", "-");
  const openChild = async (entry) => {
    const requestId = ++childDetailsRequest.current;
    setSelectedId(entry.id);
    setDetails(null);
    setGrowthUpdates([]);
    setGrowthUpdatesLoading(true);
    setGrowthFormOpen(false);
    setProfileTab("attendance");
    setSecondChanceReason("");
    setError("");
    setMessage("");
    try {
      const [history, updates] = await Promise.all([
        apiCall(`/sponsorship/children/${entry.id}/history`),
        apiCall(`/sponsorship/children/${entry.id}/updates`),
      ]);
      if (requestId !== childDetailsRequest.current) return;
      setDetails(history);
      setGrowthUpdates(updates);
    } catch (requestError) {
      if (requestId === childDetailsRequest.current) setError(requestError.message);
    } finally {
      if (requestId === childDetailsRequest.current) setGrowthUpdatesLoading(false);
    }
  };
  const closeChild = () => {
    childDetailsRequest.current += 1;
    setSelectedId(null);
    setGrowthFormOpen(false);
  };
  const addGrowthUpdate = async (event) => {
    event.preventDefault();
    if (!child) return;
    setGrowthSaving(true);
    setGrowthFormError("");
    try {
      await apiCall(`/sponsorship/children/${child.id}/updates`, {
        method: "POST",
        body: JSON.stringify(growthForm),
      });
      setGrowthUpdates(await apiCall(`/sponsorship/children/${child.id}/updates`));
      setGrowthFormOpen(false);
      setGrowthForm({
        recordedOn: new Date().toLocaleDateString("en-CA"),
        type: "growth",
        activity: "",
        heightCm: "",
        weightKg: "",
        note: "",
      });
      setMessage("Growth & Activity update added and recorded in audit history.");
    } catch (requestError) {
      setGrowthFormError(requestError.message);
    } finally {
      setGrowthSaving(false);
    }
  };
  const grantSecondChance = async (event) => {
    event.preventDefault();
    if (!selectedChild) return;
    setSaving(true);
    setError("");
    try {
      const updatedChild = await apiCall(`/sponsorship/children/${selectedChild.id}/second-chance`, {
        method: "POST",
        body: JSON.stringify({ reason: secondChanceReason }),
      });
      setDetails((current) => ({ ...current, ...updatedChild }));
      await refresh();
      setSecondChanceReason("");
      setMessage("Second chance granted and recorded in audit history.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };
  const removeChild = async () => {
    if (!selectedChild) return;
    setSaving(true);
    setError("");
    try {
      const updatedChild = await apiCall(`/sponsorship/children/${selectedChild.id}/remove`, {
        method: "POST",
        body: JSON.stringify({ reason: removalReason }),
      });
      setDetails((current) => ({ ...current, ...updatedChild }));
      await refresh();
      setConfirmRemoval(false);
      setRemovalReason("");
      setMessage("Child removed from active participation. Historical records remain available.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };
  const initials = child?.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const monthly = child?.monthly;

  return (
    <>
      <section className="sponsorship-page-hero">
        <div className="sponsorship-page-hero-copy">
          <span className="sponsorship-page-eyebrow">CHILD CARE / PARTICIPATION</span>
          <h1>Every child, thoughtfully cared for.</h1>
          <p>Track attendance, growth, care notes, education, and participation follow-up in one place.</p>
        </div>
        <div className="sponsorship-hero-art" aria-hidden="true">
          <span className="sponsorship-hero-note">2<small>activities each month</small></span>
        </div>
      </section>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}
      <section className="sponsorship-summary-grid participation-summary-grid" aria-label="Participation overview">
        {[
          ["Active children", children.filter((entry) => entry.status === "ACTIVE").length],
          ["Meeting monthly requirements", children.filter((entry) => entry.monthly.attended >= 2).length],
          ["Attendance warnings", children.filter((entry) => entry.status === "WARNING").length],
          ["Grounds for departure", children.filter((entry) => entry.status === "GROUNDS_FOR_DEPARTURE").length],
          ["Second chance", children.filter((entry) => entry.status === "SECOND_CHANCE").length],
        ].map(([label, count]) => (
          <article className="surface sponsorship-summary-card participation-summary-card" key={label}>
            <span>{label}</span><strong>{loading ? "—" : formatCount(count)}</strong>
          </article>
        ))}
      </section>
      <div className="sponsorship-workspace participation-workspace">
        <section className="surface sponsorship-child-list">
          <div className="sponsorship-list-heading">
            <div><span className="sponsorship-section-eyebrow">{isGoer ? "YOUR GROUP" : "PARTICIPANT MONITORING"}</span>            <h2>Children</h2></div>
            <span className="sponsorship-list-count">{visibleChildren.length} <small>children</small></span>
          </div>
          <div className="sponsorship-search-wrap">
            <span aria-hidden="true">⌕</span>
            <input className="form-control" aria-label="Search children" placeholder="Find a child by name or ID" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
            <div className="participation-list-controls">
              <label>
                <span>Participation</span>
                <select className="form-select" aria-label="Filter by participation status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="ACTIVE">Meeting requirements</option>
                  <option value="WARNING">Attendance warning</option>
                  <option value="GROUNDS_FOR_DEPARTURE">Follow-up needed</option>
                  <option value="SECOND_CHANCE">Second chance</option>
                </select>
              </label>
              <label>
                <span>Sort by</span>
                <select className="form-select" aria-label="Sort children" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                  <option value="attention">Needs attention</option>
                  <option value="name">Name</option>
                  <option value="attendance">Attendance rate</option>
                </select>
              </label>
            </div>
          {loading ? <div className="sponsorship-loading" role="status"><span /> Loading participation records...</div> : visibleChildren.map((entry) => (
            <button type="button" className={`sponsorship-child-row ${Number(selectedId) === Number(entry.id) ? "selected" : ""}`} key={entry.id} onClick={() => openChild(entry)}>
              <span className="sponsorship-child-avatar" aria-hidden="true">{entry.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
              <span className="sponsorship-child-copy">
                <strong>{entry.name}</strong>
                <small>{entry.participantCode || `Child #${entry.id}`} · {entry.age ?? "Age not recorded"} years · {entry.gender || "Sex not set"} · {[entry.educationLevel, entry.gradeLevel].filter(Boolean).join(" / ") || "Education not recorded"}</small>
                <small>{entry.monthly.key}: Required 2 · Attended {entry.monthly.attended} · Absent {entry.monthly.absent} · {entry.monthly.attendanceRate}%</small>
              </span>
              <span className={`participation-status-badge ${statusClass(entry.status)}`}>{PARTICIPATION_STATUS_LABELS[entry.status] || entry.status}</span>
            </button>
          ))}
          {!loading && !visibleChildren.length && <div className="sponsorship-no-results"><strong>No children match these filters</strong><p>Try another name, ID, or participation status.</p></div>}
        </section>
      </div>
      {child && createPortal((
        <div className="participant-modal-backdrop child-profile-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !confirmRemoval) closeChild();
        }}>
          <section className="participant-modal child-profile-modal participation-profile-modal" role="dialog" aria-modal="true" aria-labelledby="participation-profile-title">
            <header className="participant-modal-header">
              <div className="sponsorship-profile-summary">
                <span className="sponsorship-profile-avatar">{initials}</span>
                <div>
                  <span className="sponsorship-section-eyebrow">{child.participantCode || `CHILD #${child.id}`}</span>
                  <h2 id="participation-profile-title">{child.name}</h2>
                  <span className="sponsorship-profile-caption">{child.age ?? "Age not recorded"} years old · {child.gender || "Sex not set"} · {[child.educationLevel, child.gradeLevel].filter(Boolean).join(" / ") || "Education not recorded"}</span>
                </div>
              </div>
              <button type="button" className="btn-close" aria-label="Close child history" onClick={closeChild} />
            </header>
            <div className="participation-detail-status">
              <span className={`participation-status-badge ${statusClass(child.status)}`}>{PARTICIPATION_STATUS_LABELS[child.status] || child.status}</span>
              <span>Registered {formatParticipantHistoryDate(child.registrationDate)}</span>
            </div>
            {error && <div className="alert alert-danger" role="alert">{error}</div>}
            {message && <div className="alert alert-success" role="status">{message}</div>}
            <nav className="participation-profile-tabs" aria-label="Child care record sections">
              {[
                ["attendance", "Attendance"],
                ["care", "Growth & care"],
                ["education", "Education"],
                ["followup", "Follow-up"],
              ].map(([tab, label]) => (
                <button
                  type="button"
                  className={profileTab === tab ? "active" : ""}
                  aria-current={profileTab === tab ? "page" : undefined}
                  key={tab}
                  onClick={() => setProfileTab(tab)}
                >
                  {label}
                </button>
              ))}
            </nav>
            {profileTab === "attendance" && (
              <>
            <section className="surface participation-month-card">
              <div className="participant-history-section-heading">
                <div><span className="sponsorship-section-eyebrow">MONTHLY ACTIVITY</span><h3>{monthly.key}</h3></div>
                <span className={`participation-status-badge ${statusClass(monthly.status)}`}>{monthly.status === "ACTIVE" ? "Compliant" : "Warning"}</span>
              </div>
              <div className="participation-number-grid">
                {[["Required activities", monthly.required], ["Attended", monthly.attended], ["Absent", monthly.absent], ["Attendance", `${monthly.attendanceRate}%`]].map(([label, value]) => (
                  <div key={label}><small>{label}</small><strong>{value}</strong></div>
                ))}
              </div>
            </section>
            <section className="surface participation-month-card">
              <div className="participant-history-section-heading"><h3>Yearly attendance</h3><strong>{child.currentYear.year}</strong></div>
              <div className="participation-number-grid">
                {[["Required", child.currentYear.required], ["Attended", child.currentYear.attended], ["Absences", child.currentYear.absent], ["Attendance", `${child.currentYear.attendanceRate}%`]].map(([label, value]) => (
                  <div key={label}><small>{label}</small><strong>{value}</strong></div>
                ))}
              </div>
              <p className="participation-lifetime">Lifetime absences: <strong>{child.lifetime.absent}</strong></p>
            </section>
              </>
            )}
            {profileTab === "followup" && child.status === "GROUNDS_FOR_DEPARTURE" && (
              <>
            {child.status === "GROUNDS_FOR_DEPARTURE" && (
              <section className="participation-action-panel grounds-action-panel">
                <h3>Grounds for Departure</h3>
                <p>Total absences: <strong>{child.lifetime.absent}</strong>. This child is not automatically removed.</p>
                {canManage && (
                  <form onSubmit={grantSecondChance}>
                    <label className="form-label" htmlFor="second-chance-reason">Reason or notes (optional)</label>
                    <textarea id="second-chance-reason" className="form-control" rows="2" maxLength="1000" value={secondChanceReason} onChange={(event) => setSecondChanceReason(event.target.value)} />
                    <button type="submit" className="btn btn-primary mt-3" disabled={saving}>{saving ? "Saving..." : "Give Second Chance"}</button>
                  </form>
                )}
              </section>
            )}
              </>
            )}
            {profileTab === "followup" && child.secondChance && (
              <>
            {child.secondChance && (
              <section className="participation-action-panel second-chance-action-panel">
                <h3>Second Chance Monitoring</h3>
                <p>Granted {formatParticipantHistoryDate(child.secondChance.createdAt)} by {child.secondChance.administrator}.</p>
                <p>Absences at grant: {child.secondChance.absenceCount} · Post-second-chance absences: {child.postSecondChanceAbsences} / 2</p>
                <p>Removal becomes available after two missed monthly requirements following a second chance.</p>
                {child.secondChance.reason && <p>Notes: {child.secondChance.reason}</p>}
                {canManage && child.status === "SECOND_CHANCE" && child.removalEligible && (
                  <button type="button" className="btn btn-outline-danger" onClick={() => setConfirmRemoval(true)}>Remove from program</button>
                )}
              </section>
            )}
              </>
            )}
            {profileTab === "care" && (
            <section className="surface participation-history-section growth-activity-section">
              <div className="participant-history-section-heading">
                <div>
                  <h3>Growth &amp; Activity</h3>
                  <p>Record growth measurements and care notes. Event attendance is tracked from Check-in.</p>
                </div>
                {canRecordCare && (
                  <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => {
                    setGrowthFormError("");
                    setGrowthFormOpen(true);
                  }}>
                    + Add Update
                  </button>
                )}
              </div>
              <p className="growth-activity-count">{growthUpdates.length} {growthUpdates.length === 1 ? "update" : "updates"}</p>
              {growthUpdatesLoading ? <p role="status" className="text-secondary">Loading Growth &amp; Activity updates...</p> : growthUpdates.length ? (
                <div className="guardian-update-list">
                  {growthUpdates.map((update) => (
                    <article className={`guardian-update-card update-${update.type}`} key={update.id}>
                      <div className="guardian-update-body">
                        <div className="guardian-update-top">
                          <strong>{update.type === "growth" ? "Growth" : update.type === "activity" ? "Activity" : "Care note"}</strong>
                          <time>{formatParticipantHistoryDate(update.recordedOn)}</time>
                        </div>
                        {update.type === "growth" && (update.heightCm || update.weightKg) && (
                          <p className="guardian-update-metrics">
                            {update.heightCm && <span className="metric-height">Height: {update.heightCm} cm</span>}
                            {update.weightKg && <span className="metric-weight">Weight: {update.weightKg} kg</span>}
                          </p>
                        )}
                        {update.activity && <p className="guardian-update-activity">{update.activity}</p>}
                        {update.note && <p className="guardian-update-note">{update.note}</p>}
                      </div>
                    </article>
                  ))}
                </div>
              ) : <p className="text-secondary">No Growth &amp; Activity updates recorded yet.</p>}
            </section>
            )}
            {profileTab === "attendance" && (
              <>
            <section className="surface participation-history-section">
              <h3>Monthly attendance history</h3>
              <div className="table-responsive">
                <table className="table align-middle participant-history-table">
                  <thead><tr><th>Month</th><th>Required</th><th>Attended</th><th>Absent</th><th>Attendance</th><th>Status</th></tr></thead>
                  <tbody>{child.months.map((entry) => (
                    <tr key={entry.key}><td>{new Date(`${entry.key}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</td><td>{entry.required}</td><td>{entry.attended}</td><td>{entry.absent}</td><td>{entry.attendanceRate}%</td><td>{entry.status === "ACTIVE" ? "Active" : "Warning"}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
            <section className="surface participation-history-section">
              <div className="participant-history-section-heading">
                <h3>Participant history</h3>
                {onViewHistory && <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => { closeChild(); onViewHistory(child.id); }}>View full participant history</button>}
              </div>
              <ul className="participation-event-history">
                {child.months.flatMap((entry) => entry.events).sort((first, second) => second.date.localeCompare(first.date)).slice(0, 30).map((activity, index) => (
                  <li key={`${activity.name}-${activity.date}-${index}`}>
                    <span className={activity.attended ? "attendance-check" : "attendance-missed"}>{activity.attended ? "✓" : "×"}</span>
                    <div><strong>{activity.attended ? "Attended" : "Missed"} {activity.name}</strong><small>{formatParticipantHistoryDate(activity.date)}{activity.location ? ` · ${activity.location}` : ""}</small></div>
                  </li>
                ))}
                {!child.months.some((entry) => entry.events.length) && <li className="text-secondary">No event records found.</li>}
              </ul>
            </section>
              </>
            )}
            {profileTab === "education" && (
              <section className="surface participation-history-section">
                <div className="participant-history-section-heading">
                  <div><h3>Education history</h3><p className="text-secondary mb-0">Education records associated with this child.</p></div>
                  {onViewHistory && <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => { closeChild(); onViewHistory(child.id); }}>View full participant history</button>}
                </div>
                <div className="participation-education-current">
                  <strong>Current placement</strong>
                  <span>{[child.educationLevel, child.gradeLevel].filter(Boolean).join(" · ") || "Not recorded"}</span>
                </div>
                {child.educationHistory?.length ? (
                  <ul className="participation-event-history">
                    {child.educationHistory.map((record) => (
                      <li key={record.id}>
                        <span className="attendance-check" aria-hidden="true">▦</span>
                        <div>
                          <strong>{record.educationLevel}{record.courseStrand ? ` · ${record.courseStrand}` : ""}</strong>
                          <small>{record.schoolName || "School not recorded"} · {record.startYear}{record.endYear ? `–${record.endYear}` : "–Present"} · {record.status}</small>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-secondary mt-3 mb-0">No education history records found.</p>}
              </section>
            )}
            {profileTab === "followup" && (
              <>
            {child.history.length > 0 && (
              <section className="surface participation-history-section">
                <h3>Status history</h3>
                <ul className="participation-event-history">
                  {child.history.map((entry) => (
                    <li key={entry.id}><span className="attendance-check">✓</span><div><strong>{PARTICIPATION_STATUS_LABELS[entry.currentStatus] || entry.currentStatus}</strong><small>{formatParticipantHistoryDate(entry.createdAt)} · {entry.administrator}{entry.reason ? ` · ${entry.reason}` : ""}</small></div></li>
                  ))}
                </ul>
              </section>
            )}
              </>
            )}
          </section>
        </div>
      ), document.body)}
      {growthFormOpen && child && createPortal((
        <div className="participant-modal-backdrop growth-update-backdrop" role="presentation">
          <section className="participant-modal growth-update-modal" role="dialog" aria-modal="true" aria-labelledby="growth-update-title">
            <header className="participant-modal-header">
              <div>
                <span className="sponsorship-section-eyebrow">CHILD OBSERVATIONS</span>
                <h2 id="growth-update-title">Add Growth &amp; Activity Update</h2>
              </div>
              <button type="button" className="btn-close" aria-label="Close update form" disabled={growthSaving} onClick={() => setGrowthFormOpen(false)} />
            </header>
            <form className="growth-update-form" onSubmit={addGrowthUpdate}>
              <label className="form-label" htmlFor="growth-update-date">Date</label>
              <input id="growth-update-date" className="form-control" type="date" max={new Date().toLocaleDateString("en-CA")} required value={growthForm.recordedOn} onChange={(event) => setGrowthForm({ ...growthForm, recordedOn: event.target.value })} />
              <label className="form-label" htmlFor="growth-update-type">Update type</label>
              <select id="growth-update-type" className="form-select" value={growthForm.type} onChange={(event) => setGrowthForm({ ...growthForm, type: event.target.value })}>
                <option value="growth">Growth</option>
                <option value="activity">Activity</option>
                <option value="note">Care note</option>
              </select>
              {growthForm.type === "growth" && (
                <div className="growth-measurement-fields">
                  <div><label className="form-label" htmlFor="growth-update-height">Height (cm)</label><input id="growth-update-height" className="form-control" type="number" min="30" max="260" step="0.1" value={growthForm.heightCm} onChange={(event) => setGrowthForm({ ...growthForm, heightCm: event.target.value })} /></div>
                  <div><label className="form-label" htmlFor="growth-update-weight">Weight (kg)</label><input id="growth-update-weight" className="form-control" type="number" min="1" max="300" step="0.1" value={growthForm.weightKg} onChange={(event) => setGrowthForm({ ...growthForm, weightKg: event.target.value })} /></div>
                </div>
              )}
              {growthForm.type === "activity" && (
                <>
                  <label className="form-label" htmlFor="growth-update-activity">Activity</label>
                  <input id="growth-update-activity" className="form-control" maxLength="120" required value={growthForm.activity} onChange={(event) => setGrowthForm({ ...growthForm, activity: event.target.value })} />
                </>
              )}
              <label className="form-label" htmlFor="growth-update-note">{growthForm.type === "note" ? "Care note" : "Notes"}</label>
              <textarea id="growth-update-note" className="form-control" rows="4" maxLength="2000" required={growthForm.type === "note"} value={growthForm.note} onChange={(event) => setGrowthForm({ ...growthForm, note: event.target.value })} />
              {growthFormError && <div className="alert alert-danger" role="alert">{growthFormError}</div>}
              <div className="growth-update-actions">
                <button type="button" className="btn btn-outline-secondary" disabled={growthSaving} onClick={() => setGrowthFormOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={growthSaving}>{growthSaving ? "Saving..." : "Save Update"}</button>
              </div>
            </form>
          </section>
        </div>
      ), document.body)}
      {confirmRemoval && child && createPortal((
        <div className="participant-modal-backdrop" role="presentation">
          <section className="participant-modal participation-removal-modal" role="alertdialog" aria-modal="true" aria-labelledby="remove-child-title">
            <h2 id="remove-child-title">Remove child from the program?</h2>
            <dl className="participation-removal-details">
              <div><dt>Child</dt><dd>{child.name}</dd></div>
              <div><dt>Total absences</dt><dd>{child.lifetime.absent}</dd></div>
              <div><dt>Second chance</dt><dd>Granted</dd></div>
              <div><dt>Post-second-chance absences</dt><dd>{child.postSecondChanceAbsences}</dd></div>
            </dl>
            <p className="alert alert-warning">The child will be removed from active participation. Historical records will be preserved.</p>
            <label className="form-label" htmlFor="removal-reason">Reason</label>
            <textarea id="removal-reason" className="form-control" rows="2" maxLength="1000" value={removalReason} onChange={(event) => setRemovalReason(event.target.value)} />
            <div className="participation-removal-actions">
              <button type="button" className="btn btn-outline-secondary" disabled={saving} onClick={() => setConfirmRemoval(false)}>Cancel</button>
              <button type="button" className="btn btn-danger" disabled={saving} onClick={removeChild}>{saving ? "Removing..." : "Remove from program"}</button>
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
  const moduleLabels = {
    dashboard: "Dashboard",
    participants: "Participants",
    events: "Events",
    checkin: "Check-in",
    analytics: "Analytics",
    reports: "Reports",
    sponsorship: "Sponsored care",
  };
  const modules = [...new Set(STAFF_PERMISSION_OPTIONS.map(({ key }) => key.split(":")[0]))];
  return (
    <div className="staff-permission-modules">
      {modules.map((module) => (
        <section className="staff-permission-module" key={module}>
          <h3>{moduleLabels[module] || module}</h3>
          <div className="staff-permission-list">
            {STAFF_PERMISSION_OPTIONS.filter(({ key }) => key.startsWith(`${module}:`)).map(({ key, label, description }) => (
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
          {module === "participants" && (
            <div className="staff-permission-locked-list">
              <div><strong>Create participants</strong><span>🔒 Admin only — participant creation is restricted to Administrators.</span></div>
              <div><strong>Import participants</strong><span>🔒 Admin only — participant data import is restricted to Administrators.</span></div>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
function StaffAccounts({ user }) {
  const [staff, setStaff] = useState([]);
  const [goers, setGoers] = useState([]);
  const [educationLevels, setEducationLevels] = useState(EDUCATION_LEVELS);
  const [goerGroups, setGoerGroups] = useState({});
  const [search, setSearch] = useState("");
  const [accountTypeFilter, setAccountTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
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
  const [detailsAccount, setDetailsAccount] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [confirmation, setConfirmation] = useState(null);

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
    if (!confirmation && !detailsAccount) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !saving) {
        setConfirmation(null);
        setDetailsAccount(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [confirmation, detailsAccount, saving]);

  useEffect(() => {
    let mounted = true;
    Promise.all([apiCall("/staff"), apiCall("/goers")])
      .then(([staffResult, goerResult]) => {
        if (!mounted) return;
        setStaff(staffResult.staff);
        setEducationLevels(goerResult.educationLevels || EDUCATION_LEVELS);
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
      setMessage("Account created successfully.");
      setStaff((previous) => [...previous, result.staff].sort((left, right) =>
        left.fullName.localeCompare(right.fullName),
      ));
      setPermissionsById((previous) => ({
        ...previous,
        [result.staff.id]: result.staff.permissions,
      }));
      setRegistrationType(null);
    } catch (createError) {
      setError(createError.message || "Unable to create account. Please check the information and try again.");
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
      setMessage("Account created successfully.");
      setRegistrationType(null);
    } catch (createError) {
      setError(createError.message || "Unable to create account. Please check the information and try again.");
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
      setMessage("Education group updated successfully.");
    } catch (saveError) {
      setError(saveError.message || "Unable to update education group.");
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
      setMessage(status === "active" ? "Account reactivated successfully." : "Account deactivated successfully.");
    } catch (statusError) {
      setError(statusError.message || "Unable to update account status.");
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
      setMessage("Permissions updated successfully.");
      setPermissionEditor(null);
    } catch (saveError) {
      setError(saveError.message || "Unable to update permissions.");
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
    const status = account.status === "active" ? "inactive" : "active";
    if (status === "inactive" && String(account.id) === String(user?.id)) {
      setError("You cannot deactivate the account you are currently using.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await apiCall(`/staff/${account.id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      setStaff((previous) => previous.map((item) =>
        item.id === account.id ? { ...item, status } : item,
      ));
      setMessage(status === "active" ? "Account reactivated successfully." : "Account deactivated successfully.");
    } catch (statusError) {
      setError(statusError.message || "Unable to update account status.");
    } finally {
      setSaving(false);
    }
  };

  const openAccountDetails = async (account, type) => {
    setError("");
    setDetailsAccount({ ...account, accountType: type });
    setRecentActivity([]);
    setLoadingActivity(true);
    try {
      const result = await apiCall("/audit-logs?limit=100");
      setRecentActivity(result.entries.filter((entry) =>
        entry.entity_type === "user" && String(entry.entity_id) === String(account.id),
      ).slice(0, 5));
    } catch (activityError) {
      setError(activityError.message || "Unable to load account activity.");
    } finally {
      setLoadingActivity(false);
    }
  };

  const matchesSearch = (account) => {
    const query = search.trim().toLowerCase();
    return !query || [account.fullName, account.email, account.username]
      .some((value) => String(value || "").toLowerCase().includes(query));
  };
  const matchesStatus = (account) => statusFilter === "all" || account.status === statusFilter;
  const filteredGoers = goers.filter((account) =>
    (accountTypeFilter === "all" || accountTypeFilter === "goer") &&
    matchesStatus(account) && matchesSearch(account),
  );
  const filteredStaff = staff.filter((account) =>
    (accountTypeFilter === "all" || accountTypeFilter === "staff") &&
    matchesStatus(account) && matchesSearch(account),
  );
  const hasSearchResults = filteredGoers.length + filteredStaff.length > 0;
  const requestGroupSave = (account) => setConfirmation({
    title: "Change this Goer's assigned education group?",
    message: `Save ${goerGroups[account.id]} as ${account.fullName}'s assigned education group?`,
    confirmLabel: "Save group",
    onConfirm: () => saveGoerGroup(account),
  });
  const requestStatusChange = (account, type) => {
    const activating = account.status !== "active";
    if (!activating && type === "staff" && String(account.id) === String(user?.id)) {
      setError("You cannot deactivate the account you are currently using.");
      return;
    }
    const accountType = type === "goer" ? "Goer" : "Church Administrator";
    setConfirmation({
      title: `${activating ? "Reactivate" : "Deactivate"} this ${accountType} account?`,
      message: activating ? "" : "This account will no longer be able to sign in.",
      confirmLabel: activating ? "Reactivate Account" : "Deactivate Account",
      onConfirm: () => type === "goer" ? toggleGoerStatus(account) : toggleStatus(account),
    });
  };
  const displayAccountDate = (value) => {
    if (!value) return "Not available";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
  };
  const activityLabel = (action) => ({
    "goer.created": "Account created",
    "staff.created": "Account created",
    "goer.group.updated": "Education group changed",
    "staff.permissions.updated": "Permissions updated",
    "goer.inactive": "Account deactivated",
    "staff.inactive": "Account deactivated",
    "goer.active": "Account reactivated",
    "staff.active": "Account reactivated",
  }[action] || String(action || "Account activity").replaceAll(".", " "));

  return (
    <>
      <Title
        e="STAFF ADMINISTRATION"
        t="Manage accounts."
        d="Create and manage Church Administrator and Goer accounts, permissions, account status, and education-group assignments."
      />
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}
      {!loading && (
        <section className="staff-account-summary" aria-label="Account summary">
          <article><span>Total accounts</span><strong>{staff.length + goers.length}</strong></article>
          <article><span>Active accounts</span><strong>{staff.filter((account) => account.status === "active").length + goers.filter((account) => account.status === "active").length}</strong></article>
          <article><span>Goer accounts</span><strong>{goers.length}</strong></article>
          <article><span>Church Administrators</span><strong>{staff.length}</strong></article>
        </section>
      )}
      <section className="surface staff-account-filters" aria-label="Filter accounts">
        <label>
          <span className="visually-hidden">Search accounts</span>
          <input
            className="form-control"
            type="search"
            placeholder="Search accounts..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <span>Account type</span>
          <select className="form-select" value={accountTypeFilter} onChange={(event) => setAccountTypeFilter(event.target.value)}>
            <option value="all">All</option>
            <option value="goer">Goer</option>
            <option value="staff">Church Administrator</option>
          </select>
        </label>
        <label>
          <span>Status</span>
          <select className="form-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      </section>
      <section className="surface form-surface staff-create-panel">
        <div className="panel-title"><h2>Register account</h2></div>
        <p className="text-secondary">Choose the account type to open its registration form.</p>
        <div className="d-flex flex-wrap gap-2">
          <button className="btn btn-dark" type="button" onClick={() => openRegistrationModal("staff")}>Register Church Administrator</button>
          <button className="btn btn-outline-primary" type="button" onClick={() => openRegistrationModal("goer")}>Register Goer</button>
        </div>
      </section>
      {loading && <p className="staff-account-loading" role="status">Loading accounts...</p>}
      {!loading && search.trim() && !hasSearchResults && (
        <p className="alert alert-info" role="status">No accounts match your search.</p>
      )}
      <section className="surface table-surface staff-list-panel">
        <div className="panel-title"><h2>Goer accounts</h2><span>{filteredGoers.length} accounts</span></div>
        {!loading && filteredGoers.length ? (
          <div className="staff-account-list">
            {filteredGoers.map((account) => (
              <article className="staff-account-card" key={account.id}>
                <div className="staff-account-heading">
                  <div><h3>{account.fullName}</h3><p>{account.email} · Goer</p></div>
                  <span className={`staff-account-status ${account.status}`}>● {account.status === "active" ? "Active" : "Inactive"}</span>
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
                      {educationLevels.map((level) => <option key={level} value={level}>{level}</option>)}
                    </select>
                  </div>
                  <div className="col-12 col-sm-auto">
                    <button
                      className="btn btn-outline-primary btn-sm"
                      type="button"
                      disabled={saving || goerGroups[account.id] === account.goerEducationLevel}
                      onClick={() => requestGroupSave(account)}
                    >
                      Save group
                    </button>
                  </div>
                </div>
                <div className="staff-account-actions">
                  <button className="btn btn-sm btn-outline-primary" type="button" onClick={() => openAccountDetails(account, "Goer")}>View Details</button>
                  <button className={`btn btn-sm ${account.status === "active" ? "btn-outline-danger" : "btn-outline-success"}`} disabled={saving} onClick={() => requestStatusChange(account, "goer")}>
                    {account.status === "active" ? "Deactivate account" : "Reactivate account"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : !loading && (
          <p className="text-secondary">{goers.length ? "No Goer accounts match the current filters." : "No Goer accounts found."}</p>
        )}
      </section>
      <section className="surface table-surface staff-list-panel">
        <div className="panel-title"><h2>Church Administrator accounts</h2><span>{filteredStaff.length} accounts</span></div>
        {!loading && filteredStaff.length ? (
          <div className="staff-account-list">
            {filteredStaff.map((account) => (
              <article className="staff-account-card" key={account.id}>
                <div className="staff-account-heading">
                  <div>
                    <h3>{account.fullName}</h3>
                    <p>{account.email} · {account.role}</p>
                  </div>
                  <span className={`staff-account-status ${account.status}`}>● {account.status === "active" ? "Active" : "Inactive"}</span>
                </div>
                <div className="staff-account-permissions">
                  <div>
                    <strong>{(permissionsById[account.id] || []).length} permissions assigned</strong>
                    <div className="staff-permission-badges">
                      {selectedPermissionLabels(permissionsById[account.id] || []).slice(0, 3).map((label) => (
                        <span className="staff-permission-badge" key={label}>{label}</span>
                      ))}
                      {(permissionsById[account.id] || []).length > 3 && (
                        <button type="button" className="staff-more-permissions" onClick={() => openAccountDetails(account, "Church Administrator")}>
                          +{(permissionsById[account.id] || []).length - 3} more
                        </button>
                      )}
                      {!(permissionsById[account.id] || []).length && <span>No page access assigned</span>}
                    </div>
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
                  <button className="btn btn-sm btn-outline-primary" type="button" onClick={() => openAccountDetails(account, "Church Administrator")}>View Details</button>
                  <button className={`btn btn-sm ${account.status === "active" ? "btn-outline-danger" : "btn-outline-success"}`} disabled={saving} onClick={() => requestStatusChange(account, "staff")}>
                    {account.status === "active" ? "Deactivate account" : "Reactivate account"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : !loading && (
          <p className="text-secondary">{staff.length ? "No Church Administrator accounts match the current filters." : "No Church Administrator accounts found."}</p>
        )}
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
                  <label className="form-label" htmlFor="register-email">Email (login)</label>
                  <input id="register-email" className="form-control" type="email" autoComplete="email" maxLength={150} required value={registrationForm.email} onChange={(event) => setRegistrationField("email", event.target.value)} />
                </div>
                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="register-password">Password</label>
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
                    {educationLevels.map((level) => <option key={level} value={level}>{level}</option>)}
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
      {detailsAccount && createPortal(
        <div
          className="staff-permission-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDetailsAccount(null);
          }}
        >
          <section
            className="staff-permission-modal staff-account-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-account-details-title"
          >
            <header className="staff-permission-modal-header">
              <div>
                <span className="eyebrow">ACCOUNT DETAILS</span>
                <h2 id="staff-account-details-title">{detailsAccount.fullName}</h2>
                <p>{detailsAccount.accountType} account</p>
              </div>
              <button type="button" className="btn-close" aria-label="Close account details" onClick={() => setDetailsAccount(null)} />
            </header>
            <dl className="staff-account-detail-grid">
              <div><dt>Name</dt><dd>{detailsAccount.fullName || "—"}</dd></div>
              {detailsAccount.accountType === "Church Administrator" && (
                <div><dt>Username</dt><dd>{detailsAccount.username || "Not available"}</dd></div>
              )}
              <div><dt>Email</dt><dd>{detailsAccount.email || "—"}</dd></div>
              <div><dt>Account type</dt><dd>{detailsAccount.accountType}</dd></div>
              <div><dt>Status</dt><dd>{detailsAccount.status === "active" ? "Active" : "Inactive"}</dd></div>
              <div><dt>Created</dt><dd>{displayAccountDate(detailsAccount.createdAt)}</dd></div>
              <div><dt>Last login</dt><dd>{displayAccountDate(detailsAccount.lastLoginAt)}</dd></div>
              {detailsAccount.accountType === "Goer" && (
                <div><dt>Assigned education group</dt><dd>{detailsAccount.goerEducationLevel || "Not assigned"}</dd></div>
              )}
            </dl>
            {detailsAccount.accountType === "Church Administrator" && (
              <section className="staff-detail-permissions">
                <h3>Permissions</h3>
                <div className="staff-permission-badges">
                  {selectedPermissionLabels(permissionsById[detailsAccount.id] || []).map((label) => (
                    <span className="staff-permission-badge" key={label}>{label}</span>
                  ))}
                  {!(permissionsById[detailsAccount.id] || []).length && <span>No page access assigned</span>}
                </div>
              </section>
            )}
            <section className="staff-detail-activity">
              <h3>Recent activity</h3>
              {loadingActivity ? <p role="status">Loading recent activity...</p> : recentActivity.length ? (
                <ul>
                  {recentActivity.map((entry) => (
                    <li key={entry.id}>
                      <span>{activityLabel(entry.action)}</span>
                      <small>{entry.username} · {displayAccountDate(entry.created_at)}</small>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-secondary">No recent account activity found.</p>}
            </section>
            <footer className="staff-permission-modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={() => setDetailsAccount(null)}>Close</button>
            </footer>
          </section>
        </div>,
        document.body,
      )}
      {confirmation && createPortal(
        <div
          className="staff-permission-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setConfirmation(null);
          }}
        >
          <section
            className="staff-permission-modal staff-confirmation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-confirmation-title"
          >
            <header className="staff-permission-modal-header">
              <div>
                <span className="eyebrow">CONFIRM ACCOUNT CHANGE</span>
                <h2 id="staff-confirmation-title">{confirmation.title}</h2>
                {confirmation.message && <p>{confirmation.message}</p>}
              </div>
              <button type="button" className="btn-close" aria-label="Close confirmation" disabled={saving} onClick={() => setConfirmation(null)} />
            </header>
            <footer className="staff-permission-modal-footer">
              <button type="button" className="btn btn-outline-secondary" disabled={saving} onClick={() => setConfirmation(null)}>Cancel</button>
              <button
                type="button"
                className={`btn ${confirmation.confirmLabel === "Deactivate Account" ? "btn-danger" : "btn-primary"}`}
                disabled={saving}
                onClick={() => {
                  const confirmAction = confirmation.onConfirm;
                  setConfirmation(null);
                  confirmAction();
                }}
              >
                {saving ? "Saving…" : confirmation.confirmLabel}
              </button>
            </footer>
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
  const [page, setPage] = useState(() => {
    const route = window.location.pathname.match(/^\/participants(?:\/(\d+))?\/?$/);
    return route ? (route[1] ? "participantHistory" : "participants") : "dashboard";
  });
  const [participantHistoryId, setParticipantHistoryId] = useState(() => {
    const route = window.location.pathname.match(/^\/participants\/(\d+)\/?$/);
    return route?.[1] || "";
  });
  const [pageChanging, setPageChanging] = useState(false);
  const [pageTransitionId, setPageTransitionId] = useState(0);
  const pageTransitionTimer = useRef(null);
  const authTransitionTimer = useRef(null);
  useEffect(() => {
    const expire = () => setUser(null);
    window.addEventListener("auth-expired", expire);
    return () => window.removeEventListener("auth-expired", expire);
  }, []);
  useEffect(() => {
    const syncParticipantRoute = () => {
      const route = window.location.pathname.match(/^\/participants(?:\/(\d+))?\/?$/);
      if (route?.[1]) {
        setParticipantHistoryId(route[1]);
        setPage("participantHistory");
      } else if (route) {
        setParticipantHistoryId("");
        setPage("participants");
      } else {
        setParticipantHistoryId("");
        setPage((current) => current === "participantHistory" ? "participants" : current);
      }
    };
    window.addEventListener("popstate", syncParticipantRoute);
    return () => window.removeEventListener("popstate", syncParticipantRoute);
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
    if (page === "participantHistory") {
      window.history.replaceState({}, "", nextPage === "participants" ? "/participants" : "/");
      setParticipantHistoryId("");
    }
    clearTimeout(pageTransitionTimer.current);
    setPage(nextPage);
    setPageChanging(true);
    setPageTransitionId((current) => current + 1);
    pageTransitionTimer.current = setTimeout(() => setPageChanging(false), 450);
  };
  const openParticipantHistory = (participantId) => {
    const id = String(participantId || "").trim();
    if (!/^\d+$/.test(id)) return;
    window.history.pushState({ participantId: id }, "", `/participants/${id}`);
    setParticipantHistoryId(id);
    navigateToPage("participantHistory");
  };
  const backToParticipants = () => {
    window.history.replaceState({}, "", "/participants");
    setParticipantHistoryId("");
    navigateToPage("participants");
  };
  if (!user) {
    return (
      <>
        <PublicHome onLogin={completeLogin} />
        {authTransition && <LoadingScreen message={authTransition} />}
      </>
    );
  }
  const isAdmin = String(user.role || "").toLowerCase() === "system administrator";
  let pages = {
    dashboard: <Dashboard go={navigateToPage} user={user} />,
    participants: (
      <Participants
        canCreateImport={isAdmin}
        canEdit={canAccessPermission("participants:edit", user)}
        canDelete={canAccessPermission("participants:delete", user)}
        isGoer={String(user.role).toLowerCase() === GOER_ROLE}
        user={user}
        onViewHistory={openParticipantHistory}
      />
    ),
    participantHistory: <ParticipantHistoryPage key={participantHistoryId} participantId={participantHistoryId} onBack={backToParticipants} />,
    events: <Events canManage={canAccessPermission("events:manage", user)} />,
    scanner: <Scanner user={user} />,
    sponsorship: <SponsoredCare user={user} onViewHistory={openParticipantHistory} />,
    analytics: <Analytics user={user} />,
    reports: <Reports user={user} />,
  };
  if (canAccessPage("account", user)) {
    pages.account = <AccountSettings onUserUpdated={setUser} />;
  }
  if (String(user.role).toLowerCase() === "system administrator") {
    pages.audit = <AuditHistory />;
    pages.staff = <StaffAccounts user={user} />;
  }
  const availablePages = Object.keys(pages).filter((key) => canAccessPage(key, user));
  const visiblePage = canAccessPage(page, user) ? page : availablePages[0];
  return (
    <div className="app-shell">
      <Header
        user={user}
        page={visiblePage === "participantHistory" ? "participants" : visiblePage}
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
