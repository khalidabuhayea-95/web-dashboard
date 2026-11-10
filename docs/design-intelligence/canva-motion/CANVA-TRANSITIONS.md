# Canva Page Transitions

Path: hover between page thumbnails → «إضافة انتقال» (later «تغيير الانتقال») → side panel «الانتقالات».
- Every transition has «المدة (ثواني)», default **0.5 s**; the official range is 0.1–2.5 s.
- The transition **overlaps the end of the outgoing page**: page 1's label changed from 5.0 s to 4.7 s, and the transition began at 4.57 s.

| Transition | Controls | Mechanism (measured at 0.5 s) | Status |
|---|---|---|---|
| لا يوجد None | — | hard cut | — |
| تضاؤل Dissolve | duration | Incoming page opacity 0→1, **linear**; outgoing page static underneath | M |
| إزاحة Slide | duration, left/right/up/down | Push: outgoing 0→−100%, incoming +100%→0, **linear**, in sync | M |
| المسح الدائري Circle wipe | duration, in/out | Hard-edged radial mask `radial-gradient(circle, transparent r%, black r%)`, r 97.6%→1%, **linear** | M |
| حركة قصيرة Short swing | duration, CW/CCW | Incoming page rotate −90°→0 around the bottom-left corner, **cubicOut-like** (−12° left at 50%) | M |
| مسح اللون Colour wipe | duration, 8 directions (4 sides + 4 diagonals) | not measured | O |
| المسح الخطي Line wipe | duration, 4 directions | not measured | O |
| المطابقة والنقل Match & move | duration | not measured (morphs matching elements, per its name) | O |
| التدفق Flow | duration | not measured | O |
| تكديس Stack | duration | not measured | O |

## Notes
- Transitions are linear except Short swing. Canva leaves the "feel" to the element animations.
- The device's reduced-motion setting removes transitions (official).
- In video designs, transitions sit only between clips on the main track (official).
- **For single-page invitations transitions do not apply.** They matter only for multi-page / story formats (e.g. a "save the date" sequence).
