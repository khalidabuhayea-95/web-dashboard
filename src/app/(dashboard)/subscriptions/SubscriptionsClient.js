"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Store, AlertTriangle } from "lucide-react";
import { Badge, Button, Card, CardContent, Input } from "@/components/ui";

// The three packages, in the order they are sold. `allowanceKey` addresses the
// mediaCredits settings blob; `priceKeys` address the reference-price map.
const PACKAGES = [
  // ★Free is a ONE-TIME grant, not a monthly refill — the field name is
  // historical (monthlyAllowance) but the credits never come back, so the
  // label must not say "monthly".
  { key: "free", label: "Free", allowanceKey: "monthlyAllowance", priceKeys: null, oneTime: true },
  {
    key: "plus",
    label: "Nayroz Plus",
    allowanceKey: "plusMonthlyAllowance",
    priceKeys: { monthly: "plus_monthly", yearly: "plus_yearly" },
  },
  {
    key: "pro",
    label: "Nayroz Pro",
    allowanceKey: "proMonthlyAllowance",
    priceKeys: { monthly: "pro_monthly", yearly: "pro_yearly" },
  },
];

// Mirrors packageEconomics() on the server. Duplicated rather than fetched so
// the numbers move as the admin types, before anything is saved.
const WORST_USD_PER_CREDIT = 0.0004;
const STORE_COMMISSION = 0.15;

const usd = (value) =>
  value === null || value === undefined ? "—" : `$${Number(value).toFixed(2)}`;

const centsToInput = (cents) =>
  cents === null || cents === undefined ? "" : (Number(cents) / 100).toFixed(2);

function tierBadge(tier) {
  if (tier === "pro") return <Badge className="bg-violet-100 text-violet-900">Pro</Badge>;
  if (tier === "plus") return <Badge className="bg-amber-100 text-amber-900">Plus</Badge>;
  return <Badge className="bg-slate-100 text-slate-700">Free</Badge>;
}

export default function SubscriptionsClient() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [subscribers, setSubscribers] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsRes, subsRes] = await Promise.all([
        fetch("/api/settings/mobile-app", { cache: "no-store" }),
        fetch("/api/admin/subscriptions", { cache: "no-store" }),
      ]);
      if (!settingsRes.ok) throw new Error("Could not load mobile app settings");
      if (!subsRes.ok) throw new Error("Could not load subscribers");
      const settingsJson = await settingsRes.json();
      const subsJson = await subsRes.json();

      const credits = settingsJson?.settings?.mediaCredits ?? {};
      setSettings(settingsJson.settings ?? {});
      setForm({
        monthlyAllowance: String(credits.monthlyAllowance ?? 1000),
        plusMonthlyAllowance: String(credits.plusMonthlyAllowance ?? 10000),
        proMonthlyAllowance: String(credits.proMonthlyAllowance ?? 50000),
        referencePrices: Object.fromEntries(
          Object.entries(credits.referencePrices ?? {}).map(([key, cents]) => [
            key,
            centsToInput(cents),
          ])
        ),
      });
      setSubscribers(subsJson.subscribers ?? []);
      setSummary(subsJson.summary ?? null);
    } catch (loadError) {
      setError(loadError.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const economics = useMemo(() => {
    if (!form) return {};
    const result = {};
    for (const pkg of PACKAGES) {
      const allowance = Number(form[pkg.allowanceKey]) || 0;
      const worstCost = allowance * WORST_USD_PER_CREDIT;
      const monthlyPrice = pkg.priceKeys
        ? Number(form.referencePrices[pkg.priceKeys.monthly]) || 0
        : 0;
      const yearlyPrice = pkg.priceKeys
        ? Number(form.referencePrices[pkg.priceKeys.yearly]) || 0
        : 0;
      const netMonthly = monthlyPrice * (1 - STORE_COMMISSION);
      // A yearly subscriber costs us the allowance EVERY month, so the
      // comparison has to be per-month on both sides.
      const netYearlyPerMonth = (yearlyPrice * (1 - STORE_COMMISSION)) / 12;
      result[pkg.key] = {
        worstCost,
        netMonthly: monthlyPrice ? netMonthly : null,
        netYearlyPerMonth: yearlyPrice ? netYearlyPerMonth : null,
        monthlyOk: monthlyPrice ? netMonthly > worstCost : null,
        yearlyOk: yearlyPrice ? netYearlyPerMonth > worstCost : null,
      };
    }
    return result;
  }, [form]);

  const save = useCallback(async () => {
    if (!form || !settings) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const referencePrices = Object.fromEntries(
        Object.entries(form.referencePrices).map(([key, value]) => [
          key,
          Math.round((Number(value) || 0) * 100),
        ])
      );
      const response = await fetch("/api/settings/mobile-app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          mediaCredits: {
            ...(settings.mediaCredits ?? {}),
            monthlyAllowance: Number(form.monthlyAllowance) || 0,
            plusMonthlyAllowance: Number(form.plusMonthlyAllowance) || 0,
            proMonthlyAllowance: Number(form.proMonthlyAllowance) || 0,
            referencePrices,
          },
        }),
      });
      if (!response.ok) throw new Error("Save failed");
      setMessage("Saved. New allowances apply to every wallet immediately.");
      await load();
    } catch (saveError) {
      setError(saveError.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [form, settings, load]);

  const changeTier = useCallback(
    async (row, tier) => {
      setError(null);
      setMessage(null);
      try {
        const response = await fetch("/api/admin/subscriptions", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mobileUserId: row.mobileUserId, tier }),
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json?.error || "Could not change the tier");
        setMessage(
          json.overriddenByStore
            ? "Changed — but this account has a store subscription, so the next webhook will overwrite it."
            : "Subscription updated."
        );
        await load();
      } catch (patchError) {
        setError(patchError.message);
      }
    },
    [load]
  );

  if (loading || !form) {
    return <p className="p-6 text-sm text-slate-500">Loading subscriptions…</p>;
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Subscriptions</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Everything here is live: allowances change every wallet on the next request, and prices
          feed the app&apos;s paywall wherever the store has no answer (dev builds, the simulator, a
          storefront outage) — with no app release. When Apple or Google do answer, their localized
          price is what&apos;s shown and charged, so <strong>keep these prices mirroring the store
          consoles</strong>.
        </p>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800">
          {message}
        </div>
      ) : null}

      {summary ? (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: "Free", value: summary.counts.free },
            { label: "Plus", value: summary.counts.plus },
            { label: "Pro", value: summary.counts.pro },
            { label: "Manual grants", value: summary.counts.manual },
          ].map((stat) => (
            <Card key={stat.label}>
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">{stat.label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{stat.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-5 p-5">
          <div>
            <h2 className="text-lg font-semibold">Packages</h2>
            <p className="text-sm text-slate-600">
              Free credits are granted <strong>once per account</strong> and never refill; paid
              tiers reset every month. Worst case assumes every credit is spent on the most
              expensive tool
              (${WORST_USD_PER_CREDIT.toFixed(4)}/credit). A package that clears it cannot be sold at
              a loss however it is used.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {PACKAGES.map((pkg) => {
              const econ = economics[pkg.key] ?? {};
              return (
                <div key={pkg.key} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center gap-2">
                    {pkg.key !== "free" ? <Crown className="h-4 w-4 text-amber-500" /> : null}
                    <h3 className="font-semibold">{pkg.label}</h3>
                  </div>

                  <label className="mt-3 block text-xs font-medium text-slate-600">
                    {pkg.oneTime ? "One-time AI credits" : "Monthly AI credits"}
                  </label>
                  <Input
                    type="number"
                    min="0"
                    value={form[pkg.allowanceKey]}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        [pkg.allowanceKey]: event.target.value,
                      }))
                    }
                  />

                  {pkg.priceKeys ? (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {[
                        ["Monthly $", pkg.priceKeys.monthly],
                        ["Yearly $", pkg.priceKeys.yearly],
                      ].map(([label, key]) => (
                        <div key={key}>
                          <label className="block text-xs font-medium text-slate-600">{label}</label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={form.referencePrices[key] ?? ""}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                referencePrices: {
                                  ...current.referencePrices,
                                  [key]: event.target.value,
                                },
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <dl className="mt-3 space-y-1 text-xs text-slate-600">
                    <div className="flex justify-between">
                      <dt>{pkg.oneTime ? "Worst-case cost, once" : "Worst-case cost / mo"}</dt>
                      <dd className="tabular-nums font-medium">{usd(econ.worstCost)}</dd>
                    </div>
                    {pkg.priceKeys ? (
                      <>
                        <div className="flex justify-between">
                          <dt>Net after store cut (monthly plan)</dt>
                          <dd
                            className={`tabular-nums font-medium ${
                              econ.monthlyOk === false ? "text-red-600" : ""
                            }`}
                          >
                            {usd(econ.netMonthly)}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt>Net per month (yearly plan)</dt>
                          <dd
                            className={`tabular-nums font-medium ${
                              econ.yearlyOk === false ? "text-red-600" : ""
                            }`}
                          >
                            {usd(econ.netYearlyPerMonth)}
                          </dd>
                        </div>
                      </>
                    ) : null}
                  </dl>

                  {pkg.priceKeys && (econ.monthlyOk === false || econ.yearlyOk === false) ? (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-red-700">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      A subscriber who spends the whole allowance on the priciest tool costs more
                      than this plan earns.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save packages"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <h2 className="text-lg font-semibold">Subscribers</h2>
          <p className="mb-3 text-sm text-slate-600">
            Soonest to expire first. Store-backed rows are owned by Apple and Google — a manual
            change to one is overwritten by its next webhook.
          </p>

          {subscribers.length === 0 ? (
            <p className="text-sm text-slate-500">No paid subscribers yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Account</th>
                    <th className="py-2 pr-3">Tier</th>
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3">Plan</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Expires</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {subscribers.map((row) => (
                    <tr key={row.mobileUserId} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{row.email || row.name || "—"}</div>
                        <div className="text-xs text-slate-500">{row.mobileUserId.slice(0, 8)}…</div>
                      </td>
                      <td className="py-2 pr-3">{tierBadge(row.tier)}</td>
                      <td className="py-2 pr-3">
                        {row.source === "store" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                            <Store className="h-3.5 w-3.5" />
                            {row.platform}
                            {row.environment && row.environment !== "production" ? (
                              <Badge className="ml-1 bg-amber-100 text-amber-900">
                                {row.environment}
                              </Badge>
                            ) : null}
                          </span>
                        ) : (
                          <Badge className="bg-slate-100 text-slate-700">manual</Badge>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {row.planKey || "—"}
                        {row.periodType === "trial" ? (
                          <Badge className="ml-1 bg-teal-100 text-teal-900">trial</Badge>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {row.status || "—"}
                        {row.source === "store" && !row.autoRenewing ? (
                          <span className="ml-1 text-amber-700">(not renewing)</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-xs tabular-nums">
                        {row.expiresAt ? row.expiresAt.slice(0, 10) : "never"}
                      </td>
                      <td className="py-2 text-right">
                        {row.source === "store" ? (
                          <span className="text-xs text-slate-400">store-owned</span>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => changeTier(row, "free")}
                          >
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
