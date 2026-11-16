import { notFound } from "next/navigation";

import StoreButtons from "./StoreButtons";
import { loadSharedTemplate } from "./shareTemplate.server";

/**
 * Public landing page for a template share link: https://nayroz.com/t/<ref>
 *
 * `<ref>` is a template uuid or its slug — both resolve, exactly as in
 * /api/mobile/templates/[slug].
 *
 * This page lives outside the (dashboard) and (editor) route groups on purpose:
 * auth is enforced by those groups' layouts, so anything inside them redirects
 * to /login. A share link must stay public.
 *
 * On a phone with the app installed and App Links / Universal Links verified,
 * the OS intercepts the URL before this page ever renders. This page is what a
 * recipient sees otherwise: on desktop, in an in-app browser, without the app,
 * or on iOS when the URL was pasted rather than tapped (iOS deliberately does
 * not hand pasted URLs to apps).
 */

const SITE_NAME = "نيروز";

export async function generateMetadata({ params }) {
  const { ref } = await params;
  const template = await loadSharedTemplate(ref);

  if (!template) {
    return {
      title: `القالب غير متاح — ${SITE_NAME}`,
      description: "هذا الرابط لم يعد يشير إلى قالب متاح.",
      robots: { index: false, follow: false },
    };
  }

  const title = `${template.title} — ${SITE_NAME}`;
  const description = `افتح هذا القالب في تطبيق ${SITE_NAME} وعدّله كما تشاء — نصوص وصور وألوان، ثم صدّره من هاتفك.`;
  const images = template.ogImageUrl
    ? [
        {
          url: template.ogImageUrl,
          ...(template.ogImageType ? { type: template.ogImageType } : {}),
          alt: template.title,
        },
      ]
    : [];

  return {
    title,
    description,
    alternates: { canonical: template.shareUrl },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "ar_AR",
      url: template.shareUrl,
      title,
      description,
      ...(images.length ? { images } : {}),
    },
    twitter: {
      card: images.length ? "summary_large_image" : "summary",
      title,
      description,
      ...(images.length ? { images: [template.ogImageUrl] } : {}),
    },
  };
}

export default async function TemplateSharePage({ params }) {
  const { ref } = await params;
  const template = await loadSharedTemplate(ref);

  if (!template) notFound();

  const aspectRatio = template.canvas
    ? `${template.canvas.width} / ${template.canvas.height}`
    : "4 / 5";

  return (
    <div dir="rtl" lang="ar" className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-5 py-8">
        <header className="flex items-center justify-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/nayroz-logo-color.svg" alt="" aria-hidden="true" className="h-8 w-8" />
          <span className="text-xl font-extrabold tracking-tight">{SITE_NAME}</span>
        </header>

        <main className="flex flex-col gap-6">
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div
              className="flex w-full items-center justify-center bg-muted"
              style={{ aspectRatio }}
            >
              {template.imageUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={template.imageUrl}
                  alt={template.title}
                  className="h-full w-full object-contain"
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src="/nayroz-logo-color.svg"
                  alt=""
                  aria-hidden="true"
                  className="h-16 w-16 opacity-40"
                />
              )}
            </div>

            <div className="flex flex-col gap-2 p-5">
              <div className="flex flex-wrap items-center gap-2">
                {template.categoryLabel ? (
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                    {template.categoryLabel}
                    {template.subCategoryLabel && template.subCategoryLabel !== template.categoryLabel
                      ? ` · ${template.subCategoryLabel}`
                      : ""}
                  </span>
                ) : null}
                {template.isDraft ? (
                  <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
                    مسودة — معاينة للمختبِرين
                  </span>
                ) : null}
              </div>

              <h1 className="text-lg font-bold leading-7">{template.title}</h1>

              {template.canvas ? (
                <p className="text-sm text-muted-foreground">
                  مقاس التصميم: {template.canvas.width} × {template.canvas.height} بكسل
                </p>
              ) : null}
            </div>
          </section>

          <div className="flex flex-col gap-3">
            {/*
              The CTA uses the custom `nayroz://` scheme rather than the https share URL on
              purpose. A recipient reaching this page is already ON nayroz.com, and iOS does not
              fire a Universal Link for a same-domain navigation — an https link here would just
              reload the page. The custom scheme is registered by both apps and opens them
              directly. When the app is not installed the tap does nothing visible (iOS may show
              an "address is invalid" notice), which is why the store buttons sit right below and
              the copy says so plainly.
            */}
            <a
              href={template.appUrl}
              className="flex w-full items-center justify-center rounded-xl bg-primary px-5 py-4 text-base font-bold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
            >
              افتح القالب في تطبيق {SITE_NAME}
            </a>
            <p className="text-center text-sm leading-6 text-muted-foreground">
              يعمل الزر إذا كان التطبيق مثبّتًا على جهازك. وإن لم يكن مثبّتًا، حمّل
              {" "}{SITE_NAME}{" "}من الأسفل ثم افتح الرابط مرة أخرى.
            </p>
          </div>

          <section className="flex flex-col gap-3">
            <h2 className="text-center text-sm font-bold text-muted-foreground">حمّل التطبيق</h2>
            <StoreButtons />
          </section>
        </main>

        <footer className="mt-auto pt-4 text-center text-xs text-muted-foreground">
          <a className="hover:text-foreground" href="/landing.html">
            {SITE_NAME} — استوديو التصميم العربي
          </a>
        </footer>
      </div>
    </div>
  );
}
