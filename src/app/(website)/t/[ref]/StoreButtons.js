import { APP_STORE_URL, PLAY_STORE_URL } from "./appStores";

/**
 * The two store badges, styled after the ones on the marketing pages
 * (public/download.html) but rebuilt with the dashboard's Tailwind tokens so the
 * page needs no extra stylesheet and no third-party asset.
 */
export default function StoreButtons() {
  return (
    <div className="grid grid-cols-2 gap-3">
      <a
        href={APP_STORE_URL}
        className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-sm font-semibold text-foreground transition-colors hover:border-primary hover:text-primary"
        aria-label="تنزيل نيروز من App Store"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 shrink-0">
          <path
            fill="currentColor"
            d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"
          />
        </svg>
        <span className="flex flex-col leading-tight">
          <small className="text-[0.65rem] font-normal text-muted-foreground">تنزيل من</small>
          <strong className="text-sm font-bold">App Store</strong>
        </span>
      </a>

      <a
        href={PLAY_STORE_URL}
        className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-sm font-semibold text-foreground transition-colors hover:border-primary hover:text-primary"
        aria-label="تنزيل نيروز من Google Play"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 shrink-0">
          <path fill="#00C3FF" d="M3.1 1.6c-.3.3-.5.8-.5 1.4v18c0 .6.2 1.1.5 1.4L13 12.5 3.1 1.6z" />
          <path fill="#FF424B" d="M16.5 9 4.8 2.6c-.7-.4-1.3-.4-1.7 0L13 12.5 16.5 9z" />
          <path fill="#FFCE00" d="M16.5 16 13 12.5 3.1 22.4c.4.4 1 .4 1.7 0L16.5 16z" />
          <path fill="#00DE76" d="M16.5 9 13 12.5 16.5 16l4-2.3c1.1-.6 1.1-1.7 0-2.4L16.5 9z" />
        </svg>
        <span className="flex flex-col leading-tight">
          <small className="text-[0.65rem] font-normal text-muted-foreground">احصل عليه من</small>
          <strong className="text-sm font-bold">Google Play</strong>
        </span>
      </a>
    </div>
  );
}
