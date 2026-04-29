import React, { useEffect, useRef, useState } from "react";
import { adminApi, formatApiError } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Switch } from "../../components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import RarityBadge from "../../components/RarityBadge";
import TypeBadge from "../../components/TypeBadge";
import { TYPE_LIST } from "../../lib/pokemonTypes";
import { Pencil, Upload, Check, XCircle, Star, Trash2, FileUp } from "lucide-react";
import { toast } from "sonner";

const RARITIES = ["common", "uncommon", "rare", "legendary"];

export default function PokemonTab() {
    const [list, setList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState({ name: "", power_level: 100, rarity: "common", type: "normal", description: "", active: false, featured: false });
    const [uploading, setUploading] = useState(false);
    const [seeding, setSeeding] = useState(false);
    const [bulkOpen, setBulkOpen] = useState(false);
    // Each item: { file, name, rarity, description, preview }
    const [bulkItems, setBulkItems] = useState([]);
    const [bulkActive, setBulkActive] = useState(true);
    const [bulkFeatured, setBulkFeatured] = useState(true);
    const [bulkRunning, setBulkRunning] = useState(false);
    const [bulkResult, setBulkResult] = useState(null);
    const fileRef = useRef(null);
    const bulkFileRef = useRef(null);

    const load = () => {
        setLoading(true);
        adminApi.get("/admin/pokemon").then((r) => setList(r.data)).finally(() => setLoading(false));
    };
    useEffect(() => { load(); }, []);

    const openEdit = (p) => {
        setEditing(p);
        setForm({
            name: p.name,
            power_level: p.power_level,
            rarity: p.rarity,
            type: p.type || "normal",
            description: p.description,
            active: p.active,
            featured: !!p.featured,
        });
        setOpen(true);
    };

    const save = async () => {
        try {
            await adminApi.patch(`/admin/pokemon/${editing.id}`, {
                ...form,
                power_level: Number(form.power_level),
            });
            toast.success("Saved");
            load();
            setOpen(false);
        } catch (e) { toast.error(formatApiError(e)); }
    };

    const toggleActive = async (p) => {
        try {
            await adminApi.patch(`/admin/pokemon/${p.id}`, { active: !p.active });
            load();
        } catch (e) { toast.error(formatApiError(e)); }
    };

    const toggleFeatured = async (p) => {
        try {
            await adminApi.patch(`/admin/pokemon/${p.id}`, { featured: !p.featured });
            load();
        } catch (e) { toast.error(formatApiError(e)); }
    };

    const deletePokemon = async (p) => {
        if (!window.confirm(`Permanently delete "${p.name}"? This cannot be undone.`)) return;
        try {
            await adminApi.delete(`/admin/pokemon/${p.id}`);
            toast.success(`Deleted ${p.name}`);
            load();
        } catch (e) { toast.error(formatApiError(e)); }
    };

    const onBulkFilesPicked = (e) => {
        const files = Array.from(e.target.files || []);
        const items = files.map((f) => {
            const baseName = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
            return {
                file: f,
                name: baseName.slice(0, 60),
                rarity: "common",
                type: "normal",
                description: "",
                preview: URL.createObjectURL(f),
            };
        });
        setBulkItems(items);
    };

    const updateBulkItem = (i, patch) => {
        setBulkItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
    };

    const removeBulkItem = (i) => {
        setBulkItems((arr) => {
            const it = arr[i];
            if (it?.preview) URL.revokeObjectURL(it.preview);
            return arr.filter((_, idx) => idx !== i);
        });
    };

    const setRarityForAll = (r) => {
        setBulkItems((arr) => arr.map((it) => ({ ...it, rarity: r })));
    };

    const runBulkUpload = async () => {
        if (!bulkItems.length) { toast.error("Pick at least one image"); return; }
        const blanks = bulkItems.filter((it) => !it.name?.trim());
        if (blanks.length) { toast.error(`${blanks.length} item(s) need a name`); return; }
        setBulkRunning(true);
        setBulkResult(null);
        try {
            const fd = new FormData();
            bulkItems.forEach((it) => {
                fd.append("files", it.file);
                fd.append("names", it.name.trim());
                fd.append("rarities", it.rarity);
                fd.append("types", it.type || "normal");
                fd.append("descriptions", it.description || "");
            });
            fd.append("active", String(bulkActive));
            fd.append("featured", String(bulkFeatured));
            const res = await adminApi.post("/admin/pokemon/bulk-upload", fd, {
                headers: { "Content-Type": "multipart/form-data" },
                timeout: 180000,
            });
            setBulkResult(res.data);
            toast.success(`Created ${res.data.created_count} • Failed ${res.data.failed_count}`);
            // Free the preview URLs and clear the staging list on success
            bulkItems.forEach((it) => it.preview && URL.revokeObjectURL(it.preview));
            setBulkItems([]);
            if (bulkFileRef.current) bulkFileRef.current.value = "";
            load();
        } catch (e) { toast.error(formatApiError(e)); }
        finally { setBulkRunning(false); }
    };

    const uploadImage = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !editing) return;
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append("file", file);
            const res = await adminApi.post(`/admin/pokemon/${editing.id}/image`, fd, {
                headers: { "Content-Type": "multipart/form-data" },
            });
            setEditing(res.data);
            toast.success("Image uploaded");
            load();
        } catch (err) { toast.error(formatApiError(err)); }
        finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    const activeCount = list.filter((p) => p.active).length;

    return (
        <div>
            <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
                <div>
                    <h2 className="font-heading text-2xl font-bold text-slate-900">Pokemon Roster</h2>
                    <p className="text-slate-500 text-sm">
                        <span data-testid="pokemon-active-count">{activeCount}</span> active / {list.length} total slots
                    </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                    <Button
                        onClick={() => { setBulkResult(null); setBulkOpen(true); }}
                        className="tactile-btn rounded-2xl bg-river-500 hover:bg-river-600 text-white font-heading font-bold"
                        data-testid="bulk-upload-btn"
                    >
                        <FileUp className="w-4 h-4 mr-1.5" /> Bulk Upload
                    </Button>
                    <Button
                        onClick={async () => {
                            if (!window.confirm("Generate 12 AI Pokemon images and activate them? Takes ~1 minute.")) return;
                            setSeeding(true);
                            try {
                                const r = await adminApi.post("/admin/seed-test-pokemon");
                                toast.success(`Seeded ${r.data.seeded} / ${r.data.attempted} Pokemon`);
                                load();
                            } catch (e) { toast.error(formatApiError(e)); }
                            finally { setSeeding(false); }
                        }}
                        disabled={seeding}
                        className="tactile-btn rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-heading font-bold"
                        data-testid="seed-test-pokemon-btn"
                    >
                        {seeding ? "Generating…" : "✨ Seed 12 Test Pokemon"}
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="text-center text-slate-400 py-16">Loading…</div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {list.map((p) => (
                        <div key={p.id} className="bg-white rounded-3xl border border-slate-200 overflow-hidden" data-testid={`pokemon-slot-${p.slot_number}`}>
                            <div className={`relative aspect-square flex items-center justify-center ${p.image_data_url ? `rarity-${p.rarity}` : "bg-slate-100"}`}>
                                {p.image_data_url ? (
                                    <img src={p.image_data_url} alt={p.name} className="max-w-[80%] max-h-[80%]" />
                                ) : (
                                    <div className="text-slate-400 text-xs font-bold uppercase">No image</div>
                                )}
                                <div className="absolute top-2 left-2 text-xs font-bold bg-white/90 text-slate-700 px-2 py-0.5 rounded-full">#{p.slot_number}</div>
                                <button
                                    onClick={() => toggleActive(p)}
                                    className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center ${p.active ? "bg-emerald-500 text-white" : "bg-white/90 text-slate-400"}`}
                                    title={p.active ? "Active" : "Inactive"}
                                    data-testid={`toggle-active-${p.id}`}
                                >
                                    {p.active ? <Check className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                                </button>
                                <button
                                    onClick={() => toggleFeatured(p)}
                                    className={`absolute top-10 right-2 w-7 h-7 rounded-full flex items-center justify-center shadow-sm ${p.featured ? "bg-amber-400 text-slate-900" : "bg-white/80 text-slate-400"}`}
                                    title={p.featured ? "Featured — spawns more often" : "Mark as supervisor pokemon"}
                                    data-testid={`toggle-featured-${p.id}`}
                                >
                                    <Star className={`w-4 h-4 ${p.featured ? "fill-slate-900" : ""}`} />
                                </button>
                            </div>
                            <div className="p-3">
                                <div className="font-heading font-bold text-slate-900 text-sm truncate">{p.name}</div>
                                <div className="mt-2 flex items-center justify-between gap-1 flex-wrap">
                                    <div className="flex items-center gap-1 flex-wrap">
                                        <RarityBadge rarity={p.rarity} className="text-[10px] px-2 py-0.5" />
                                        {p.type && p.type !== "normal" && <TypeBadge type={p.type} size="sm" />}
                                    </div>
                                    <span className="text-xs font-bold text-slate-500">PWR {p.power_level}</span>
                                </div>
                                <div className="flex gap-1 mt-3">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => openEdit(p)}
                                        className="flex-1 rounded-xl h-8 text-xs"
                                        data-testid={`edit-pokemon-${p.id}`}
                                    >
                                        <Pencil className="w-3 h-3 mr-1" /> Edit
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => deletePokemon(p)}
                                        className="rounded-xl h-8 px-2 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                                        title="Delete pokemon"
                                        data-testid={`delete-pokemon-${p.id}`}
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="rounded-3xl max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-2xl">Edit Pokemon #{editing?.slot_number}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className={`relative aspect-square rounded-2xl flex items-center justify-center max-w-[200px] mx-auto ${editing?.image_data_url ? `rarity-${editing.rarity}` : "bg-slate-100"}`}>
                            {editing?.image_data_url ? (
                                <img src={editing.image_data_url} alt="" className="max-w-[80%] max-h-[80%]" />
                            ) : (
                                <span className="text-slate-400 text-xs">No image</span>
                            )}
                        </div>
                        <div className="flex items-center justify-center">
                            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadImage} className="hidden" data-testid="pokemon-file-input" />
                            <Button onClick={() => fileRef.current?.click()} disabled={uploading} variant="outline" className="rounded-2xl">
                                <Upload className="w-4 h-4 mr-2" /> {uploading ? "Uploading…" : "Upload Image"}
                            </Button>
                        </div>

                        <div>
                            <Label>Name</Label>
                            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-2xl h-11" data-testid="pokemon-form-name" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Label>Power Level (1-1000)</Label>
                                <Input type="number" min="1" max="1000" value={form.power_level} onChange={(e) => setForm({ ...form, power_level: e.target.value })} className="rounded-2xl h-11" data-testid="pokemon-form-power" />
                            </div>
                            <div>
                                <Label>Rarity</Label>
                                <Select value={form.rarity} onValueChange={(v) => setForm({ ...form, rarity: v })}>
                                    <SelectTrigger className="rounded-2xl h-11" data-testid="pokemon-form-rarity"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {RARITIES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div>
                            <Label>Type</Label>
                            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                                <SelectTrigger className="rounded-2xl h-11" data-testid="pokemon-form-type"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {TYPE_LIST.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Description</Label>
                            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="rounded-2xl" data-testid="pokemon-form-desc" />
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-3">
                            <div>
                                <Label className="text-slate-900">Active in spawn pool</Label>
                                <p className="text-xs text-slate-500">Only active pokemon can spawn</p>
                            </div>
                            <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} data-testid="pokemon-form-active" />
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-amber-50 border border-amber-200 p-3">
                            <div>
                                <Label className="text-slate-900 flex items-center gap-1"><Star className="w-4 h-4 text-amber-500 fill-amber-400" /> Featured (supervisor)</Label>
                                <p className="text-xs text-slate-500">Spawns 4× more often than other pokemon — use for your hand-picked camp Pokemon.</p>
                            </div>
                            <Switch checked={form.featured} onCheckedChange={(v) => setForm({ ...form, featured: v })} data-testid="pokemon-form-featured" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)} className="rounded-2xl">Cancel</Button>
                        <Button onClick={save} className="tactile-btn rounded-2xl bg-river-500 hover:bg-river-600 text-white font-heading" data-testid="pokemon-form-save">Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Bulk upload dialog */}
            <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
                <DialogContent className="rounded-3xl max-w-3xl max-h-[90vh] flex flex-col" data-testid="bulk-upload-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-2xl flex items-center gap-2">
                            <FileUp className="w-6 h-6 text-river-600" /> Bulk Upload Pokemon
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-3 py-1 overflow-y-auto pr-1 flex-1 min-h-0">
                        <p className="text-xs text-slate-500">
                            Pick PNG / JPG / WEBP files. Edit the <b>name</b>, <b>rarity</b>, and <b>description</b> for each one before uploading.
                        </p>

                        {/* File picker */}
                        <input
                            ref={bulkFileRef}
                            type="file"
                            multiple
                            accept="image/png,image/jpeg,image/webp"
                            onChange={onBulkFilesPicked}
                            className="block w-full text-sm rounded-2xl border border-slate-200 px-3 py-2 file:mr-3 file:rounded-xl file:border-0 file:bg-river-100 file:text-river-700 file:px-3 file:py-1.5 file:font-bold"
                            data-testid="bulk-upload-files"
                        />

                        {/* Quick "set all to rarity" buttons */}
                        {bulkItems.length > 1 && (
                            <div className="flex items-center gap-2 flex-wrap text-xs text-slate-600 bg-slate-50 rounded-2xl p-2">
                                <span className="font-bold uppercase tracking-widest">Apply to all:</span>
                                {RARITIES.map((r) => (
                                    <button
                                        key={r}
                                        type="button"
                                        onClick={() => setRarityForAll(r)}
                                        className="px-2.5 py-1 rounded-full bg-white border border-slate-200 hover:bg-slate-100 capitalize"
                                        data-testid={`bulk-set-all-${r}`}
                                    >
                                        {r}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Per-image rows */}
                        {bulkItems.length === 0 ? (
                            <div className="rounded-2xl border-2 border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
                                No images selected yet
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {bulkItems.map((it, i) => (
                                    <div
                                        key={i}
                                        className="rounded-2xl bg-slate-50 border border-slate-200 p-3 flex gap-3 items-start"
                                        data-testid={`bulk-item-${i}`}
                                    >
                                        <img
                                            src={it.preview}
                                            alt={it.name}
                                            className="w-16 h-16 rounded-xl object-cover bg-white border border-slate-200 shrink-0"
                                            draggable={false}
                                        />
                                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-2">
                                            <div className="sm:col-span-2">
                                                <Label className="text-[10px] uppercase tracking-widest text-slate-500">Name</Label>
                                                <Input
                                                    value={it.name}
                                                    onChange={(e) => updateBulkItem(i, { name: e.target.value })}
                                                    className="rounded-xl h-9 text-sm"
                                                    data-testid={`bulk-name-${i}`}
                                                    placeholder="Pokemon name"
                                                />
                                            </div>
                                            <div>
                                                <Label className="text-[10px] uppercase tracking-widest text-slate-500">Rarity</Label>
                                                <Select
                                                    value={it.rarity}
                                                    onValueChange={(v) => updateBulkItem(i, { rarity: v })}
                                                >
                                                    <SelectTrigger className="rounded-xl h-9 text-sm" data-testid={`bulk-rarity-${i}`}>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {RARITIES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div>
                                                <Label className="text-[10px] uppercase tracking-widest text-slate-500">Type</Label>
                                                <Select
                                                    value={it.type || "normal"}
                                                    onValueChange={(v) => updateBulkItem(i, { type: v })}
                                                >
                                                    <SelectTrigger className="rounded-xl h-9 text-sm" data-testid={`bulk-type-${i}`}>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {TYPE_LIST.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="sm:col-span-4">
                                                <Label className="text-[10px] uppercase tracking-widest text-slate-500">Description</Label>
                                                <Textarea
                                                    value={it.description}
                                                    onChange={(e) => updateBulkItem(i, { description: e.target.value })}
                                                    rows={2}
                                                    className="rounded-xl text-sm"
                                                    data-testid={`bulk-desc-${i}`}
                                                    placeholder="Optional — short blurb the campers see in their Pokedex"
                                                />
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => removeBulkItem(i)}
                                            className="w-8 h-8 rounded-full bg-white border border-slate-200 text-red-500 hover:bg-red-50 flex items-center justify-center shrink-0"
                                            title="Remove this image"
                                            data-testid={`bulk-remove-${i}`}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Batch toggles */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-3">
                                <Label className="text-slate-900 text-sm">Activate immediately</Label>
                                <Switch checked={bulkActive} onCheckedChange={setBulkActive} data-testid="bulk-upload-active" />
                            </div>
                            <div className="flex items-center justify-between rounded-2xl bg-amber-50 border border-amber-200 p-3">
                                <Label className="text-slate-900 flex items-center gap-1 text-sm">
                                    <Star className="w-4 h-4 text-amber-500 fill-amber-400" /> Featured
                                </Label>
                                <Switch checked={bulkFeatured} onCheckedChange={setBulkFeatured} data-testid="bulk-upload-featured" />
                            </div>
                        </div>

                        {bulkResult && (
                            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-sm" data-testid="bulk-upload-result">
                                <div className="font-bold text-emerald-800">
                                    Created {bulkResult.created_count} • Failed {bulkResult.failed_count}
                                </div>
                                {bulkResult.failed?.length > 0 && (
                                    <ul className="mt-2 text-xs text-red-600 list-disc list-inside">
                                        {bulkResult.failed.map((f, i) => (
                                            <li key={i}>{f.name}: {f.error}</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>

                    <DialogFooter className="border-t border-slate-100 pt-3">
                        <Button variant="outline" onClick={() => setBulkOpen(false)} className="rounded-2xl">Close</Button>
                        <Button
                            onClick={runBulkUpload}
                            disabled={bulkRunning || bulkItems.length === 0}
                            className="tactile-btn rounded-2xl bg-river-500 hover:bg-river-600 text-white font-heading"
                            data-testid="bulk-upload-submit"
                        >
                            {bulkRunning ? "Uploading…" : `Upload ${bulkItems.length || ""}`}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
