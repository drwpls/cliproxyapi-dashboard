"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { API_ENDPOINTS } from "@/lib/api-endpoints";

interface ResetCredit {
  id: string;
  status?: string;
  title?: string;
  expires_at?: string;
}

interface ResetCreditsResponse {
  credits?: ResetCredit[];
  available_count?: number;
}

interface CodexResetCreditsPanelProps {
  authIndex: string | number;
}

// Renders a "refresh" button that fetches the account's available rate-limit
// reset credits, and a "redeem" button (guarded by a confirm dialog) that asks
// CLIProxyAPI to consume the unused credit. CLIProxyAPI resolves which credit
// id to redeem, so the dashboard only needs the account's auth_index.
export function CodexResetCreditsPanel({ authIndex }: CodexResetCreditsPanelProps) {
  const t = useTranslations("quota");
  const { showToast } = useToast();
  const index = String(authIndex);

  const [loading, setLoading] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [info, setInfo] = useState<ResetCreditsResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  const availableCount = info?.available_count ?? 0;

  const fetchCredits = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_ENDPOINTS.CODEX.RESET_CREDITS}?auth_index=${encodeURIComponent(index)}`
      );
      if (!res.ok) {
        showToast(t("resetCreditsRefreshError"), "error");
        return;
      }
      const data = (await res.json()) as ResetCreditsResponse;
      setInfo(data);
      setLoaded(true);
      showToast(
        t("resetCreditsRefreshSuccess", { count: data.available_count ?? 0 }),
        "success"
      );
    } catch {
      showToast(t("resetCreditsRefreshError"), "error");
    } finally {
      setLoading(false);
    }
  };

  const consume = async () => {
    setConfirmOpen(false);
    setRedeeming(true);
    try {
      const res = await fetch(API_ENDPOINTS.CODEX.RESET_CREDITS_CONSUME, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth_index: index }),
      });
      if (!res.ok) {
        let detail = "";
        try {
          const body = (await res.json()) as { error?: string; detail?: string };
          detail = body.detail || body.error || "";
        } catch {
          /* ignore parse errors */
        }
        showToast(
          detail
            ? `${t("resetCreditsRedeemError")}: ${detail}`
            : t("resetCreditsRedeemError"),
          "error"
        );
        return;
      }
      showToast(t("resetCreditsRedeemSuccess"), "success");
      // Refresh the count so the UI reflects the consumed credit.
      await fetchCredits();
    } catch {
      showToast(t("resetCreditsRedeemError"), "error");
    } finally {
      setRedeeming(false);
    }
  };

  const redeemDisabled = redeeming || loading || (loaded && availableCount <= 0);

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-sm border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
      <span>
        {t("resetCreditsLabel")}: {loaded ? availableCount : "—"}
      </span>
      <Button
        variant="secondary"
        onClick={fetchCredits}
        disabled={loading}
        className="px-2.5 py-1 text-[11px]"
      >
        {loading ? t("resetCreditsRefreshing") : t("resetCreditsRefresh")}
      </Button>
      <Button
        variant="primary"
        onClick={() => setConfirmOpen(true)}
        disabled={redeemDisabled}
        className="px-2.5 py-1 text-[11px]"
      >
        {redeeming ? t("resetCreditsRedeeming") : t("resetCreditsRedeem")}
      </Button>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={consume}
        title={t("resetCreditsConfirmTitle")}
        message={t("resetCreditsConfirmMessage")}
        confirmLabel={t("resetCreditsConfirmAction")}
        variant="warning"
      />
    </div>
  );
}
