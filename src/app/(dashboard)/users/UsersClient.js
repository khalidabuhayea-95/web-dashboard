"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";

const initialForm = {
  email: "",
};

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [status, setStatus] = useState("Loading users...");
  const [inviteUrl, setInviteUrl] = useState("");
  const [page, setPage] = useState(1);
  const [perPage] = useState(20);
  const [total, setTotal] = useState(0);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [editing, setEditing] = useState({
    email: "",
    password: "",
  });

  const totalPages = useMemo(() => {
    if (!total) return 1;
    return Math.max(Math.ceil(total / perPage), 1);
  }, [total, perPage]);

  const loadUsers = useCallback(async () => {
    setStatus("Loading users...");
    try {
      const response = await fetch(`/api/admin/users?page=${page}&perPage=${perPage}`);
      if (!response.ok) {
        const errorPayload = await response.json();
        throw new Error(errorPayload?.error || "Failed to load users.");
      }
      const payload = await response.json();
      setUsers(payload.users ?? []);
      setTotal(payload.total ?? 0);
      setStatus("");
    } catch (error) {
      setStatus(error.message || "Failed to load users.");
    }
  }, [page, perPage]);

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      if (!isMounted) return;
      await loadUsers();
    };

    void run();

    return () => {
      isMounted = false;
    };
  }, [loadUsers]);

  const handleInvite = async (event) => {
    event.preventDefault();
    if (!form.email) {
      setStatus("Email is required.");
      return;
    }
    setStatus("Creating registration link...");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to create registration link.");
      }
      setForm(initialForm);
      setInviteUrl(String(payload?.invite?.url || ""));
      setStatus(
        payload?.invite?.mode === "setup"
          ? "Password setup link created."
          : "Registration link created."
      );
      await loadUsers();
    } catch (error) {
      setStatus(error.message || "Failed to create registration link.");
    }
  };

  const startEdit = (user) => {
    setEditingId(user.id);
    setEditing({
      email: user.email ?? "",
      password: "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditing({ email: "", password: "" });
  };

  const handleUpdate = async (event) => {
    event.preventDefault();
    if (!editingId) return;
    setStatus("Updating user...");
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, ...editing }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update user.");
      }
      setStatus("User updated.");
      cancelEdit();
      await loadUsers();
    } catch (error) {
      setStatus(error.message || "Failed to update user.");
    }
  };

  const handleBanToggle = async (user) => {
    if (!user?.id) return;
    const isBanned = Boolean(user.banned_until);
    setStatus(isBanned ? "Removing ban..." : "Applying ban...");
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, ban: !isBanned }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update ban.");
      }
      setStatus(isBanned ? "User unbanned." : "User banned.");
      await loadUsers();
    } catch (error) {
      setStatus(error.message || "Failed to update ban.");
    }
  };

  const handleDelete = async (userId) => {
    if (!userId) return;
    setStatus("Deleting user...");
    try {
      const response = await fetch(`/api/admin/users?id=${userId}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete user.");
      }
      setStatus("User deleted.");
      await loadUsers();
    } catch (error) {
      setStatus(error.message || "Failed to delete user.");
    }
  };

  const handleCopyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setStatus("Registration link copied.");
    } catch (_error) {
      setStatus("Unable to copy the registration link automatically.");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Manage dashboard access, invite designers, and protect the system admin account.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invite new designers</CardTitle>
          <CardSubtitle>
            Generate a one-time registration or password-setup link for a designer account.
          </CardSubtitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form className="grid gap-3 md:grid-cols-[1fr_140px]" onSubmit={handleInvite}>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                placeholder="name@company.com"
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, email: event.target.value }))
                }
                required
              />
            </div>
            <div className="flex items-end">
              <Button type="submit">Create invite</Button>
            </div>
          </form>

          {inviteUrl ? (
            <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
              <div className="text-xs font-medium text-foreground">Registration link</div>
              <Input value={inviteUrl} readOnly />
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={handleCopyInvite}>
                  Copy link
                </Button>
              </div>
            </div>
          ) : null}

          {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Active users</CardTitle>
              <CardSubtitle>{total ? `${total} total` : ""}</CardSubtitle>
            </div>
            <div className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>User</TableHeaderCell>
                <TableHeaderCell>Role</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((user) => {
                const isBanned = Boolean(user.banned_until);
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="font-semibold">{user.name || user.email || user.id}</div>
                      <div className="text-xs text-muted-foreground">{user.email || user.id}</div>
                      <div className="text-xs text-muted-foreground">
                        Joined {new Date(user.created_at).toLocaleDateString()}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="neutral">{user.app_role || "designer"}</Badge>
                    </TableCell>
                    <TableCell>
                      {user.is_system_admin ? (
                        <Badge variant="neutral">System admin</Badge>
                      ) : isBanned ? (
                        <Badge variant="destructive">Banned</Badge>
                      ) : (
                        <Badge variant="success">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === user.id ? (
                        <form className="grid gap-2" onSubmit={handleUpdate}>
                          <Input
                            placeholder="Email"
                            type="email"
                            value={editing.email}
                            onChange={(event) =>
                              setEditing((prev) => ({
                                ...prev,
                                email: event.target.value,
                              }))
                            }
                          />
                          <Input
                            placeholder="Reset password"
                            type="password"
                            value={editing.password}
                            onChange={(event) =>
                              setEditing((prev) => ({
                                ...prev,
                                password: event.target.value,
                              }))
                            }
                          />
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
                            onClick={() => startEdit(user)}
                            disabled={user.is_system_admin}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => handleBanToggle(user)}
                            disabled={user.is_system_admin}
                          >
                            {isBanned ? "Unban" : "Ban"}
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            onClick={() => handleDelete(user.id)}
                            disabled={user.is_system_admin}
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {!status && users.length === 0 ? (
            <div className="mt-4 text-sm text-muted-foreground">No users yet.</div>
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
    </div>
  );
}
