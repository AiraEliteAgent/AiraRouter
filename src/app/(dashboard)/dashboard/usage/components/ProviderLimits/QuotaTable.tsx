"use client";

import { formatResetTime, calculatePercentage } from "./utils";
import { useLocale, useTranslations } from "next-intl";

/**
 * Format reset time display (Today, 12:00 PM)
 */
function formatResetTimeDisplay(resetTime, locale, t) {
  if (!resetTime) return null;

  try {
    const date = new Date(resetTime);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let dayStr = "";
    if (date >= today && date < tomorrow) {
      dayStr = t("today");
    } else if (date >= tomorrow && date < new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)) {
      dayStr = t("tomorrow");
    } else {
      dayStr = date.toLocaleDateString(locale, { month: "short", day: "numeric" });
    }

    const timeStr = date.toLocaleTimeString(locale, {
      hour: "numeric",
      minute: "2-digit",
    });

    return t("dayTimeFormat", { day: dayStr, time: timeStr });
  } catch {
    return null;
  }
}

/**
 * Get color classes based on remaining percentage
 */
function getColorClasses(remainingPercentage) {
  if (remainingPercentage > 70) {
    return {
      text: "text-green-600 dark:text-green-400",
      bg: "bg-green-500",
      bgLight: "bg-green-500/10",
      emoji: "🟢",
    };
  }

  if (remainingPercentage >= 30) {
    return {
      text: "text-yellow-600 dark:text-yellow-400",
      bg: "bg-yellow-500",
      bgLight: "bg-yellow-500/10",
      emoji: "🟡",
    };
  }

  // 0-29% including 0% (out of quota) - show red
  return {
    text: "text-red-600 dark:text-red-400",
    bg: "bg-red-500",
    bgLight: "bg-red-500/10",
    emoji: "🔴",
  };
}

/**
 * Quota Table Component - Table-based display for quota data
 */
export default function QuotaTable({ quotas = [] }) {
  const t = useTranslations("usage");
  const locale = useLocale();

  if (!quotas || quotas.length === 0) {
    return null;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-[45%] md:w-[30%]" /> {/* Model Name */}
          <col className="w-[55%] md:w-[45%]" /> {/* Limit Progress */}
          <col className="w-[0%] md:w-[25%] hidden md:table-cell" /> {/* Reset Time (Hidden on Mobile) */}
        </colgroup>
        <tbody>
          {quotas.map((quota, index) => {
            const remaining =
              quota.remainingPercentage !== undefined
                ? Math.round(quota.remainingPercentage)
                : calculatePercentage(quota.used, quota.total);
            const staleAfterReset = quota.staleAfterReset === true;

            const colors = getColorClasses(remaining);
            const countdown = formatResetTime(quota.resetAt);
            const resetDisplay = formatResetTimeDisplay(quota.resetAt, locale, t);

            return (
              <tr
                key={index}
                className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
              >
                {/* Model Name with Status Emoji */}
                <td className="py-2 px-3">
                  <div className="flex items-start md:items-center gap-1 md:gap-2">
                    <span className="text-[10px] md:text-xs mt-0.5 md:mt-0">{colors.emoji}</span>
                    <span className="text-[11px] md:text-sm font-medium text-text-primary break-all md:break-normal line-clamp-2 md:line-clamp-none">{quota.name}</span>
                  </div>
                </td>

                {/* Limit (Progress + Numbers) */}
                <td className="py-2 px-2 md:px-3">
                  <div className="space-y-1.5">
                    {/* Progress bar */}
                    <div
                      className={`h-1.5 rounded-full overflow-hidden border ${colors.bgLight} ${
                        remaining === 0
                          ? "border-black/10 dark:border-white/10"
                          : "border-transparent"
                      }`}
                    >
                      <div
                        className={`h-full transition-all duration-300 ${colors.bg}`}
                        style={{ width: `${Math.min(remaining, 100)}%` }}
                      />
                    </div>

                    {/* Numbers and Mobile Reset Time */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between text-[10px] md:text-xs gap-0.5 md:gap-0">
                      <div className="flex items-center justify-between w-full md:w-auto gap-2">
                        <span className="text-text-muted truncate">
                          {quota.used.toLocaleString()} /{" "}
                          {quota.total > 0 ? quota.total.toLocaleString() : "∞"}
                        </span>
                        <span className={`font-medium ${colors.text} md:hidden`}>{remaining}%</span>
                      </div>
                      <span className={`font-medium ${colors.text} hidden md:inline`}>{remaining}%</span>
                      
                      {/* Mobile Reset Time (shows only on small screens) */}
                      <div className="md:hidden mt-0.5 text-[9px] text-text-muted flex items-center gap-1">
                        <span className="opacity-50">⏱</span>
                        {staleAfterReset ? (
                          <span>Refresh...</span>
                        ) : countdown !== t("notAvailableSymbol") ? (
                          <span className="truncate">{countdown}</span>
                        ) : (
                          <span className="italic">N/A</span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>

                {/* Reset Time (Desktop only) */}
                <td className="py-2 px-3 hidden md:table-cell">
                  {staleAfterReset ? (
                    <div className="text-xs text-text-muted">⟳ Refreshing...</div>
                  ) : countdown !== t("notAvailableSymbol") || resetDisplay ? (
                    <div className="space-y-0.5">
                      {countdown !== t("notAvailableSymbol") && (
                        <div className="text-sm text-text-primary font-medium">
                          {t("inDuration", { duration: countdown })}
                        </div>
                      )}
                      {resetDisplay && (
                        <div className="text-xs text-text-muted">{resetDisplay}</div>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-text-muted italic">{t("notApplicable")}</div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
