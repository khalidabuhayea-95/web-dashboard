import StoreButtons from "./StoreButtons";

/**
 * Segment-scoped 404 for share links.
 *
 * The repo has no global not-found.js, so nothing is being overridden here —
 * this only replaces Next's bare default for /t/<ref>, where the visitor is a
 * chat recipient rather than a dashboard user and deserves a way forward.
 */
export const metadata = {
  title: "الرابط غير متاح — نيروز",
  description: "هذا الرابط لم يعد يشير إلى قالب متاح.",
  robots: { index: false, follow: false },
};

export default function TemplateShareNotFound() {
  return (
    <div dir="rtl" lang="ar" className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-10 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/nayroz-logo-color.svg" alt="" aria-hidden="true" className="h-10 w-10" />

        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-bold">هذا الرابط لم يعد متاحًا</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            القالب المرتبط بهذا الرابط غير منشور أو تم حذفه. جرّب طلب رابط جديد من الشخص الذي
            أرسله لك، أو تصفّح القوالب داخل التطبيق.
          </p>
        </div>

        <div className="w-full">
          <StoreButtons />
        </div>

        <a className="text-xs text-muted-foreground hover:text-foreground" href="/landing.html">
          العودة إلى موقع نيروز
        </a>
      </div>
    </div>
  );
}
