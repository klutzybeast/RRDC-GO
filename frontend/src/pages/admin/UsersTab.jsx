import React, { useEffect, useState } from "react";
import { adminApi, formatApiError } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "../../components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function UsersTab() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({ username: "", password: "", group_name: "" });

    const load = () => {
        setLoading(true);
        adminApi.get("/admin/users").then((r) => setUsers(r.data)).finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, []);

    const openCreate = () => {
        setEditing(null);
        setForm({ username: "", password: "", group_name: "" });
        setOpen(true);
    };

    const openEdit = (u) => {
        setEditing(u);
        setForm({ username: u.username, password: "", group_name: u.group_name });
        setOpen(true);
    };

    const save = async () => {
        try {
            if (editing) {
                const body = {};
                if (form.password) body.password = form.password;
                if (form.group_name) body.group_name = form.group_name;
                await adminApi.patch(`/admin/users/${editing.id}`, body);
                toast.success("User updated");
            } else {
                await adminApi.post("/admin/users", form);
                toast.success("User created");
            }
            setOpen(false);
            load();
        } catch (e) {
            toast.error(formatApiError(e));
        }
    };

    const del = async (u) => {
        if (!window.confirm(`Delete ${u.username}? All their catches will remain for analytics.`)) return;
        try {
            await adminApi.delete(`/admin/users/${u.id}`);
            toast.success("User deleted");
            load();
        } catch (e) { toast.error(formatApiError(e)); }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="font-heading text-2xl font-bold text-slate-900">Campers</h2>
                    <p className="text-slate-500 text-sm">Each login is a shared squad bank</p>
                </div>
                <Button onClick={openCreate} className="tactile-btn rounded-2xl bg-river-500 hover:bg-river-600 text-white font-heading" data-testid="create-user-btn">
                    <Plus className="w-4 h-4 mr-2" /> New Camper
                </Button>
            </div>

            <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-widest">
                        <tr>
                            <th className="text-left px-4 py-3 font-bold">Username</th>
                            <th className="text-left px-4 py-3 font-bold">Squad</th>
                            <th className="text-left px-4 py-3 font-bold">Last Login</th>
                            <th className="text-right px-4 py-3 font-bold">Actions</th>
                        </tr>
                    </thead>
                    <tbody data-testid="users-table-body">
                        {loading ? (
                            <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
                        ) : users.length === 0 ? (
                            <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">No campers yet. Add one!</td></tr>
                        ) : users.map((u) => (
                            <tr key={u.id} className="border-t border-slate-100" data-testid={`user-row-${u.id}`}>
                                <td className="px-4 py-3 font-bold text-slate-900">{u.username}</td>
                                <td className="px-4 py-3 text-slate-700">{u.group_name}</td>
                                <td className="px-4 py-3 text-slate-500">{u.last_login ? new Date(u.last_login).toLocaleString() : "—"}</td>
                                <td className="px-4 py-3 text-right">
                                    <Button variant="ghost" size="sm" onClick={() => openEdit(u)} data-testid={`edit-user-${u.id}`}>
                                        <Pencil className="w-4 h-4" />
                                    </Button>
                                    <Button variant="ghost" size="sm" onClick={() => del(u)} data-testid={`delete-user-${u.id}`}>
                                        <Trash2 className="w-4 h-4 text-red-500" />
                                    </Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="rounded-3xl">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-2xl">{editing ? "Edit Camper" : "New Camper"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>Username</Label>
                            <Input
                                value={form.username}
                                onChange={(e) => setForm({ ...form, username: e.target.value })}
                                disabled={!!editing}
                                className="rounded-2xl h-11"
                                data-testid="user-form-username"
                            />
                        </div>
                        <div>
                            <Label>{editing ? "New password (leave empty to keep)" : "Password"}</Label>
                            <Input
                                type="text"
                                value={form.password}
                                onChange={(e) => setForm({ ...form, password: e.target.value })}
                                className="rounded-2xl h-11"
                                data-testid="user-form-password"
                            />
                        </div>
                        <div>
                            <Label>Squad Name</Label>
                            <Input
                                value={form.group_name}
                                onChange={(e) => setForm({ ...form, group_name: e.target.value })}
                                placeholder="Red Squirrels"
                                className="rounded-2xl h-11"
                                data-testid="user-form-group"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)} className="rounded-2xl">Cancel</Button>
                        <Button onClick={save} className="tactile-btn rounded-2xl bg-river-500 hover:bg-river-600 text-white font-heading" data-testid="user-form-save">
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
