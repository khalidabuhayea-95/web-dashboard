"use client";

import { useState } from "react";

import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/form";
import Modal from "@/components/ui/modal";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";

export default function DesignSystemClient() {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Design System</h1>
        <p className="text-sm text-muted-foreground">
          Tokens, components, and UI patterns aligned to the dashboard.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Buttons</CardTitle>
          <CardSubtitle>Primary, secondary, ghost, destructive</CardSubtitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Badges</CardTitle>
          <CardSubtitle>Status indicators</CardSubtitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Badge>Neutral</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Forms</CardTitle>
          <CardSubtitle>Inputs, selects, and textareas</CardSubtitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input placeholder="name@company.com" />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select>
              <option>Admin</option>
              <option>Editor</option>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Notes</Label>
            <Textarea rows={3} placeholder="Optional details..." />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Table</CardTitle>
          <CardSubtitle>Data table pattern</CardSubtitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Role</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell>Ops Review</TableCell>
                <TableCell>
                  <Badge variant="success">Active</Badge>
                </TableCell>
                <TableCell>Admin</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Template Sync</TableCell>
                <TableCell>
                  <Badge variant="warning">Pending</Badge>
                </TableCell>
                <TableCell>Editor</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modal</CardTitle>
          <CardSubtitle>Overlay system</CardSubtitle>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Open modal
          </Button>
        </CardContent>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <div className="text-lg font-semibold">Confirm action</div>
          <div className="text-sm text-muted-foreground">
            This modal uses the shared overlay system.
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setOpen(false)}>Confirm</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
