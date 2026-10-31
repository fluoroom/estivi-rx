# Questions

The page is built and these choices are already in it. Change any of them when you are back.

How to open it: `docker compose up --build`, then http://localhost:8080

Decoder checks (no microphone): `npm test`

1. The packet has no timezone. The hour row and the calendar use this computer's local clock, and `HH:MM` is read as local time. Should that stay local?
2. A `NEXT` line with no weekdays is listed in the calendar only. It is not placed on today's hour row. Should an undated common block be dropped instead, or pinned to the day it was heard?
3. `DAYSLEFT 0` is kept for 14 days from the day it was heard. Is 14 days the right horizon?
4. A station or program that is not heard again leaves the guide 7 days after the last copy. Is 7 days right?
5. A common block with no `DAYS` line stays on the local date it was heard. If the range crosses midnight, the rest is shown on the next morning. Is that the right place for it?
6. The hour row runs from now until the latest program still running or still ahead today. With nothing left today it runs until midnight. Is that the window you want?
7. If any two callsigns overlap, the whole hour row becomes one lane per callsign, and that calendar day is split the same way, side by side. Callsigns that do not overlap stay in a single lane. Same-callsign overlap stays in one lane. Is the "any overlap splits the whole row" reading right?
8. Manual SSTV mode forces that mode's line timing, but a picture still starts from the VIS header. Auto ignores a VIS code that is not in the Estivi table. Should a manual mode start without a VIS, and should an unknown VIS be shown as a raw code?
9. Color is full-range JPEG YCbCr only, the same conversion the transmitter uses by default. Do you want a studio-range switch?
10. Finished pictures are stored as JPEG in localStorage, newest first, capped at 40 images or about 4 million characters. Refresh keeps them until "Clear image memory". Is JPEG in localStorage acceptable, or do you want IndexedDB and lossless PNG?
11. After a picture finishes, the visor holds that picture. The first timeline slot stays live the whole time. A new reception, or Reset, shows the live decoder. Reset stays on the live decoder until the next picture finishes. A VIS that never locks a sync does not switch the visor. Is that the freeze/live behavior you want?
12. Timeline pictures are not clickable. After a refresh the visor shows the newest saved picture. Should an older timeline picture open in the visor?
13. Channels are Mono, Left, and Right. Gain is −12 dB to +36 dB in 0.5 dB steps. The level meter covers about −42 dB to 0 dB. Are those the ranges you want?
14. The microphone is not played back through the speakers. `COMMENT` lines and frames that are not Estivi text are parsed or ignored and not shown. Is anything from those missing on screen?
15. The page title is "estivi". The server port is 8080. Device, channel, gain, SSTV mode, and the guide are stored in the browser along with the pictures. An error line appears only when the microphone cannot be opened. Should any of that stay out of storage, or should the title be different?
