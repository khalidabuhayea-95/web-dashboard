"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import clsx from "clsx";

import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import Modal from "@/components/ui/modal";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";

const PER_PAGE = 20;

const initialForm = {
  name: "",
  email: "",
  emailVerified: false,
  role: "user",
  // "" means no override — the account uses the global monthly AI allowance.
  creditAllowance: "",
};

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "banned", label: "Disabled" },
];

const ROLE_FILTERS = [
  { value: "all", label: "All roles" },
  { value: "user", label: "Users" },
  { value: "tester", label: "Testers" },
];

const PROVIDER_LABELS = {
  google: "Google",
  apple: "Apple",
  facebook: "Facebook",
};

function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || provider;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

// This month's AI wallet for one account. Older API responses predate the field,
// so a missing `credits` renders as a dash rather than "0 left".
function CreditBalance({ credits }) {
  if (!credits) return <span className="text-xs text-muted-foreground">—</span>;

  const allowance = Number(credits.allowance) || 0;
  const remaining = Number(credits.remaining) || 0;
  const used = Number(credits.used) || 0;
  const spentPercent = allowance > 0 ? Math.min(100, (used / allowance) * 100) : 100;

  // An account is worth flagging when it is out of credits, or nearly so.
  const tone =
    allowance === 0 || remaining === 0
      ? "destructive"
      : remaining / allowance <= 0.15
        ? "warning"
        : "success";

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Badge variant={tone}>
          {remaining} / {allowance}
        </Badge>
        {credits.custom ? <Badge variant="neutral">Custom</Badge> : null}
      </div>
      <div className="h-1 w-20 overflow-hidden rounded-full bg-slate-200">
        <div
          className={clsx(
            "h-full rounded-full transition-all",
            tone === "destructive"
              ? "bg-red-500"
              : tone === "warning"
                ? "bg-amber-500"
                : "bg-emerald-500"
          )}
          style={{ width: `${spentPercent}%` }}
        />
      </div>
      <div className="text-[11px] text-muted-foreground">
        {allowance === 0 ? "AI disabled" : `${used} used this month`}
      </div>
    </div>
  );
}

function MobileUserDetails({ user, onClose }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold">
              {user.name || user.email || "Mobile user"}
            </span>
            {user.banned ? <Badge variant="destructive">Disabled</Badge> : null}
            {user.role === "tester" ? <Badge variant="warning">Tester</Badge> : null}
          </div>
          <div className="text-xs text-muted-foreground">{user.email || "No email on file"}</div>
          <div className="mt-1 font-mono text-[11px] text-muted-foreground">{user.id}</div>
        </div>
        <Button type="button" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>

      {user.banned ? (
        <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
          This account is disabled: existing sessions were revoked and sign-in is blocked
          until it is re-enabled.
        </div>
      ) : null}

      {user.role === "tester" ? (
        <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
          Tester account: sees templates with status <strong>draft</strong> in the mobile app
          alongside published ones, so a template can be reviewed before it goes live.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "AI credits left",
            value: user.credits
              ? `${user.credits.remaining} / ${user.credits.allowance}`
              : "—",
            hint: user.credits
              ? `${user.credits.used} used this month${user.credits.custom ? " · custom allowance" : ""}`
              : null,
          },
          { label: "Sessions", value: user.sessionCount },
          { label: "Devices", value: user.deviceCount },
          { label: "Favorites", value: user.favoriteCount },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">{stat.label}</div>
            <div className="text-lg font-semibold tabular-nums">{stat.value}</div>
            {stat.hint ? (
              <div className="mt-0.5 text-[11px] text-muted-foreground">{stat.hint}</div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="text-sm font-semibold">Linked accounts</div>
        {user.identities.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No social login linked yet. The account links automatically the first time this
            person signs in with a matching verified email.
          </div>
        ) : (
          <ul className="space-y-2">
            {user.identities.map((identity) => (
              <li
                key={identity.id}
                className="rounded-xl border border-border p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="neutral">{providerLabel(identity.provider)}</Badge>
                  <span>{identity.email || identity.displayName || "—"}</span>
                  {identity.emailVerified ? (
                    <Badge variant="success">Verified</Badge>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Linked {formatDateTime(identity.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-sm font-semibold">Devices</div>
        {user.devices.length === 0 ? (
          <div className="text-sm text-muted-foreground">No registered push devices.</div>
        ) : (
          <ul className="space-y-2">
            {user.devices.map((device) => (
              <li key={device.id} className="rounded-xl border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="neutral">{device.platform}</Badge>
                  {device.appVersion ? <span>v{device.appVersion}</span> : null}
                  <span className="font-mono text-xs text-muted-foreground">
                    …{device.tokenSuffix}
                  </span>
                  {device.disabledAt ? <Badge variant="warning">Disabled</Badge> : null}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Last seen {formatDateTime(device.lastSeenAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-sm font-semibold">Sessions</div>
        {user.sessions.length === 0 ? (
          <div className="text-sm text-muted-foreground">No sessions recorded.</div>
        ) : (
          <ul className="space-y-2">
            {user.sessions.map((session) => (
              <li key={session.id} className="rounded-xl border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {session.active ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant="neutral">Ended</Badge>
                  )}
                  <span className="truncate text-xs text-muted-foreground">
                    {session.userAgent || "Unknown device"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Started {formatDateTime(session.createdAt)} · Expires{" "}
                  {formatDateTime(session.expiresAt)}
                  {session.ipAddress ? ` · ${session.ipAddress}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-sm font-semibold">Favorite templates</div>
        {user.favorites.length === 0 ? (
          <div className="text-sm text-muted-foreground">No favorites yet.</div>
        ) : (
          <ul className="space-y-1 text-sm">
            {user.favorites.map((favorite) => (
              <li key={favorite.id} className="flex items-center justify-between gap-3">
                <span className="truncate">
                  {favorite.templateName || favorite.templateSlug || favorite.templateId}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(favorite.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function MobileUsersSection() {
  const [users, setUsers] = useState([]);
  const [status, setStatus] = useState("Loading mobile users...");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [editing, setEditing] = useState(initialForm);
  const [detail, setDetail] = useState(null);

  const totalPages = useMemo(() => {
    if (!total) return 1;
    return Math.max(Math.ceil(total / PER_PAGE), 1);
  }, [total]);

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setAppliedSearch(search.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadUsers = useCallback(async () => {
    setStatus("Loading mobile users...");
    try {
      const params = new URLSearchParams({
        page: String(page),
        perPage: String(PER_PAGE),
        status: statusFilter,
        role: roleFilter,
      });
      if (appliedSearch) params.set("search", appliedSearch);

      const response = await fetch(`/api/admin/mobile-users?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load mobile users.");
      }
      setUsers(payload.users ?? []);
      setTotal(payload.total ?? 0);
      setStatus("");
    } catch (error) {
      setStatus(error.message || "Failed to load mobile users.");
    }
  }, [page, appliedSearch, statusFilter, roleFilter]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!form.name.trim() && !form.email.trim()) {
      setStatus("A name or an email is required.");
      return;
    }
    setStatus("Creating mobile user...");
    try {
      const response = await fetch("/api/admin/mobile-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          emailVerified: form.emailVerified,
          role: form.role,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to create mobile user.");
      }
      setForm(initialForm);
      setStatus("Mobile user created.");
      await loadUsers();
    } catch (error) {
      setStatus(error.message || "Failed to create mobile user.");
    }
  };

  const startEdit = (user) => {
    setEditingId(user.id);
    setEditing({
      name: user.name ?? "",
      email: user.email ?? "",
      emailVerified: Boolean(user.emailVerified),
      role: user.role || "user",
      creditAllowance:
        user.creditAllowance === null || user.creditAllowance === undefined
          ? ""
          : String(user.creditAllowance),
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditing(initialForm);
  };

  const handleUpdate = async (event) => {
    event.preventDefault();
    if (!editingId) return;
    setStatus("Updating mobile user...");
    try {
      const response = await fetch("/api/admin/mobile-users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          name: editing.name.trim(),
          email: editing.email.trim(),
          emailVerified: editing.emailVerified,
          role: editing.role,
          creditAllowance:
            String(editing.creditAllowance).trim() === ""
              ? null
              : Number(editing.creditAllowance),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update mobile user.");
      }
      setStatus("Mobile user updated.");
      cancelEdit();
      await loadUsers();
    } catch (error) {
      setStatus(error.message || "Failed to update mobile user.");
    }
  };

  const handleBanToggle = async (user) => {
    if (!user?.id) return;
    const who = user.name || user.email || "this user";
    const confirmed = window.confirm(
      user.banned
        ? `Re-enable ${who}? They will be able to sign in again.`
        : `Disable ${who}? They are signed out everywhere, blocked from signing back in, and stop receiving push notifications.`
    );
    if (!confirmed) return;

    setStatus(user.banned ? "Re-enabling account..." : "Disabling account...");
    try {
      const response = await fetch("/api/admin/mobile-users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, ban: !user.banned }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update the account.");
      }
      setStatus(user.banned ? "Account re-enabled." : "Account disabled.");
      await loadUsers();
    } catch (error) {
      setStatus(error.message || "Failed to update the account.");
    }
  };

  const handleRevokeSessions = async (user) => {
    if (!user?.id) return;
    const confirmed = window.confirm(
      `Sign ${user.name || user.email || "this user"} out of all devices? Their app will ask them to log in again and push delivery stops until they do.`
    );
    if (!confirmed) return;

    setStatus("Revoking sessions...");
    try {
      const response = await fetch("/api/admin/mobile-users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, revokeSessions: true }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to revoke sessions.");
      }
      setStatus("Sessions revoked.");
      await loadUsers();
    } catch (error) {
      setStatus(error.message || "Failed to revoke sessions.");
    }
  };

  const handleDelete = async (user) => {
    if (!user?.id) return;
    const confirmed = window.confirm(
      `Delete ${user.name || user.email || "this mobile user"}? Their linked logins, sessions, devices and favorites are removed. This cannot be undone.`
    );
    if (!confirmed) return;

    setStatus("Deleting mobile user...");
    try {
      const response = await fetch(
        `/api/admin/mobile-users?id=${encodeURIComponent(user.id)}`,
        { method: "DELETE" }
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete mobile user.");
      }
      setStatus("Mobile user deleted.");
      await loadUsers();
    } catch (error) {
      setStatus(error.message || "Failed to delete mobile user.");
    }
  };

  const handleShowDetails = async (userId) => {
    setStatus("Loading details...");
    try {
      const response = await fetch(`/api/admin/mobile-users/${encodeURIComponent(userId)}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load mobile user.");
      }
      setDetail(payload.user);
      setStatus("");
    } catch (error) {
      setStatus(error.message || "Failed to load mobile user.");
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a mobile account</CardTitle>
          <CardSubtitle>
            App accounts are normally created on first social sign-in. Adding one here
            pre-provisions it — the person&apos;s Google, Apple or Facebook login links to it
            automatically when the verified email matches.
          </CardSubtitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form className="grid gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={handleCreate}>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                placeholder="Full name"
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                placeholder="name@example.com"
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, email: event.target.value }))
                }
              />
            </div>
            <div className="flex items-end">
              <Button type="submit">Add user</Button>
            </div>
          </form>

          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.emailVerified}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, emailVerified: event.target.checked }))
                }
              />
              Mark email as verified
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.role === "tester"}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    role: event.target.checked ? "tester" : "user",
                  }))
                }
              />
              Tester (sees draft templates in the app)
            </label>
          </div>

          {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Mobile app users</CardTitle>
              <CardSubtitle>{total ? `${total} total` : ""}</CardSubtitle>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Select
                aria-label="Filter by status"
                className="w-40"
                value={statusFilter}
                onChange={(event) => {
                  setPage(1);
                  setStatusFilter(event.target.value);
                }}
              >
                {STATUS_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Filter by role"
                className="w-40"
                value={roleFilter}
                onChange={(event) => {
                  setPage(1);
                  setRoleFilter(event.target.value);
                }}
              >
                {ROLE_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </Select>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name, email or id…"
                  className="w-64 pl-8"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>User</TableHeaderCell>
                <TableHeaderCell>Sign-in</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Activity</TableHeaderCell>
                <TableHeaderCell>AI credits</TableHeaderCell>
                <TableHeaderCell>Last login</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="font-semibold">{user.name || user.email || user.id}</div>
                    <div className="text-xs text-muted-foreground">
                      {user.email || "No email"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Joined {formatDate(user.createdAt)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {user.providers.length === 0 ? (
                        <Badge variant="warning">No login linked</Badge>
                      ) : (
                        user.providers.map((provider) => (
                          <Badge key={provider} variant="neutral">
                            {providerLabel(provider)}
                          </Badge>
                        ))
                      )}
                      {user.emailVerified ? <Badge variant="success">Verified</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {user.banned ? (
                        <Badge variant="destructive">Disabled</Badge>
                      ) : (
                        <Badge variant="success">Active</Badge>
                      )}
                      {user.role === "tester" ? (
                        <Badge variant="warning">Tester</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs text-muted-foreground">
                      {user.sessionCount} session{user.sessionCount === 1 ? "" : "s"} ·{" "}
                      {user.deviceCount} device{user.deviceCount === 1 ? "" : "s"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {user.favoriteCount} favorite{user.favoriteCount === 1 ? "" : "s"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <CreditBalance credits={user.credits} />
                  </TableCell>
                  <TableCell>
                    <div className="text-xs text-muted-foreground">
                      {user.lastLoginAt ? formatDate(user.lastLoginAt) : "Never"}
                    </div>
                  </TableCell>
                  <TableCell>
                    {editingId === user.id ? (
                      <form className="grid gap-2" onSubmit={handleUpdate}>
                        <Input
                          placeholder="Name"
                          value={editing.name}
                          onChange={(event) =>
                            setEditing((prev) => ({ ...prev, name: event.target.value }))
                          }
                        />
                        <Input
                          placeholder="Email"
                          type="email"
                          value={editing.email}
                          onChange={(event) =>
                            setEditing((prev) => ({ ...prev, email: event.target.value }))
                          }
                        />
                        <label className="inline-flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={editing.emailVerified}
                            onChange={(event) =>
                              setEditing((prev) => ({
                                ...prev,
                                emailVerified: event.target.checked,
                              }))
                            }
                          />
                          Email verified
                        </label>
                        <label className="inline-flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={editing.role === "tester"}
                            onChange={(event) =>
                              setEditing((prev) => ({
                                ...prev,
                                role: event.target.checked ? "tester" : "user",
                              }))
                            }
                          />
                          Tester (sees drafts)
                        </label>
                        <div className="space-y-1">
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            placeholder="AI credits / month"
                            value={editing.creditAllowance}
                            onChange={(event) =>
                              setEditing((prev) => ({
                                ...prev,
                                creditAllowance: event.target.value,
                              }))
                            }
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Leave blank to use the default from Mobile settings. 0 blocks this
                            account from AI features.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="submit">Save</Button>
                          <Button type="button" variant="ghost" onClick={cancelEdit}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => handleShowDetails(user.id)}
                        >
                          Details
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => startEdit(user)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => handleRevokeSessions(user)}
                          disabled={user.sessionCount === 0 && user.deviceCount === 0}
                        >
                          Sign out
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => handleBanToggle(user)}
                        >
                          {user.banned ? "Enable" : "Disable"}
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={() => handleDelete(user)}
                        >
                          Delete
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {!status && users.length === 0 ? (
            <div className="mt-4 text-sm text-muted-foreground">
              {appliedSearch ? "No mobile users match this search." : "No mobile users yet."}
            </div>
          ) : null}

          <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
            <Button
              variant="ghost"
              type="button"
              onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            <div>
              Page {page} of {totalPages}
            </div>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        </CardContent>
      </Card>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        className="max-h-[85vh] overflow-y-auto"
      >
        {detail ? (
          <MobileUserDetails user={detail} onClose={() => setDetail(null)} />
        ) : null}
      </Modal>
    </div>
  );
}
