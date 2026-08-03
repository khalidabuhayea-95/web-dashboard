/* ══════════════════════════════════════════
   نيروز — Google Analytics 4 tag
   Loaded by every marketing page. Inert until GA_MEASUREMENT_ID is filled in,
   so shipping this file on its own changes nothing.

   Marketing/ads signals stay denied on purpose: cookies.html tells visitors
   that marketing cookies are "غير مفعّلة حالياً" and that we would ask for
   explicit consent before enabling them. Basic traffic analytics is already
   disclosed there, so it runs without a banner. If ads/remarketing is ever
   wanted, a consent banner has to land first.
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  /* "Nayroz Website" web stream (15344625355) on GA4 property 531571754 —
     the same property Firebase feeds from the iOS and Android apps. */
  var GA_MEASUREMENT_ID = 'G-NHENP8N91L';

  if (!GA_MEASUREMENT_ID) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  /* Consent defaults must be queued before the first config call. */
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'granted'
  });

  gtag('js', new Date());
  gtag('config', GA_MEASUREMENT_ID, {
    /* Keeps GA from enabling remarketing/Google Signals on this property. */
    allow_google_signals: false,
    allow_ad_personalization_signals: false
  });

  /* gtag.js drains whatever is already queued in dataLayer once it loads. */
  var script = document.createElement('script');
  script.async = true;
  script.src =
    'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_MEASUREMENT_ID);
  document.head.appendChild(script);
})();
