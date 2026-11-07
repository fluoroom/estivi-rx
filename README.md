# Estivi RX

Estivi RX is the browser receiver for [Estivi](https://github.com/fluoroom/estivi-tx). It listens to the microphone, decodes the AX.25 frames and SSTV pictures that transmitter puts on the air, and draws them on one page. There is no server-side decoder. The Docker container only serves the static files.

Open it with:

```sh
docker compose up --build
```

Then go to http://localhost:8086. The page asks for the microphone and starts receiving on its own. A denied permission on that automatic start stays quiet; pressing Start receiving shows the error.

Decoder checks, with no microphone:

```sh
npm test
```

To leave it running on the server:

```sh
docker compose up -d --build
```

The container restarts unless it is stopped by hand. It serves HTTP on host port 8086; put your existing nginx in front for TLS and headers. Browsers only expose the microphone on HTTPS or localhost.

## The page

The header is the title, a local clock with seconds and a small UTC clock with seconds under it, the input device, Mono / Left / Right, input gain, the level meter, the SSTV mode, Start / Stop receiving, the theme button, and the language selector. Gain runs from −12 dB to +36 dB in 0.5 dB steps. The slider turns red above 0 dB. The meter covers about −42 dB to 0 dB. The theme button names the theme you switch to: Light while the page is dark, Dark while it is light. Dark is the default. The page starts in English, or in Spanish when the browser's languages prefer Spanish. The language selector can force English or Español; its Auto option follows the browser again. A forced choice is saved with the other preferences.

The visor is the picture. Its shape follows the mode that is decoding. With nothing arriving it is 320×256. The picture is scaled to fit the window, and the whole frame stays visible. Under it, still outside the picture: the program or image name, the resize style button (Blur / Pixels), Save, Delete, Fullscreen, and Reset. Delete is there only for a saved picture, and it asks before removing that one picture. Color is decoded to full-range RGB, the transmitter's default, with no studio-range switch.

Blur is the default. It smooths the received picture up to the visor size. Pixels keeps each received pixel a hard block. The button names the mode you get if you click it (Pixels while Blur is on, Blur while Pixels is on); hovering it says Resize style. Timeline thumbnails stay sharp pixels either way. Save writes the received pixels as a lossless PNG and does not include the grain or the enlargement.

Grain is only on the live view. It fills the visor when nothing is arriving, and it fills the rows that have not been revealed yet while a picture is coming in. A finished picture, a picture stopped halfway, a saved thumbnail, and the Save file have none.

The first timeline slot is always the live decoder. Clicking it, or Reset, puts the big visor back on live. Clicking a saved picture shows that picture until Reset, another picture, the live slot, or a new reception. A new reception shows the live picture as it arrives, then holds the finished image. The copy is stored when the reception ends, and it becomes the second timeline entry. If the signal disappears during a picture, the page holds the partial picture and keeps looking for the same mode's lines for 30% of that mode's picture time. If the signal returns, the picture continues from where it now is and the lines lost in between stay empty. If it does not return in time, the partial picture is saved to the timeline and the visor goes back to live view. Reset gives up on the partial picture too, but only once the signal has been gone for 30% of that window (10.3 s for Martin M1, 3.2 s for Robot 36, 11.3 s for PD 120, 6.3 s for YoniQ); before then it just changes the view. A new VIS also ends the partial picture and starts the next one. The timeout is per mode: 34.3 s for Martin M1, 10.8 s for Robot 36, 37.8 s for PD 120, and 21.0 s for YoniQ. Clear image memory asks before it drops every picture and leaves the schedule. The thin receive marks on the hour row open the same saved picture.

Under the timeline, the hour row starts at the top of the current hour and runs until 12 hours after the last program still on today's guide. That window stays put so the yellow line can travel with the clock, and it is pinned again when the clock leaves it. A thin mark sits on each saved picture whose receive time falls inside the row. The same clock hour can appear twice when the row crosses midnight.

Calendar opens the next 14 days and shows only the days that have programs. A program that crosses midnight stays one entry, `23:30–00:30`, and is not cut at 00:00; the hour row draws it as one block too, and a block still running after midnight also appears on today's card. Only blocks that overlap share lanes: two overlapping programs are split side by side, while a block with nothing beside it takes the full height in the hour row and the full width in the calendar. Same-callsign overlaps split the same way. Clear calendar asks before it deletes every program.

The footer reads `LU1AQY 2026` and links to lu1aqy.radio. The page title is `estivi rx`.

Device, channel, gain, SSTV mode, the last mode actually received, theme, the scaling choice, and the language are remembered in this browser, with the pictures and the guide.

## What it receives

Audio goes through a gain stage into an AudioWorklet. The worklet demodulates the tone. AX.25 and SSTV run on the page from that frequency stream. Playback through the speakers is off, and the browser's echo cancellation, noise reduction, and automatic gain are off.

AX.25 is 1200 baud Bell 202, the way Estivi sends it: mark 1200 Hz, space 2200 Hz, NRZI, LSB first, a stuffed 0 after five 1s. A frame is kept when it is addressed to `ESTIVI`, the control byte is UI (`0x03`), the PID is `0xF0`, and the CRC residue is `0xF0B8`. The text is `ESTIVI 1` or `ESTIVI MODE`.

An info frame carries the lines in `AX25.md` of the transmitter: `FREQ`, `CALL`, `NAME`, `RANGE`, `DAYS`, `DAYSLEFT`, `NEXT`, and `COMMENT`. Unknown lines are ignored. Text that does not start with `ESTIVI ` is ignored. `COMMENT` is kept on the packet and is not shown. The frame has no date and no timezone: `HH:MM` is UTC and weekdays are the English abbreviations the transmitter sends (`Mon` … `Sun`), and the calendar shows the local weekday in the page language. The guide stores the UTC rule and places it on this computer's local calendar, so the hour row, the calendar, and the main clock show local time while the small clock in the header shows UTC.

A program with weekdays is placed on those days. `DAYSLEFT` counts from the local day it was heard, including that day; `0` means no end, and the largest value is `99`. A program stays in the guide until the calendar is cleared, even if it is not heard again; its own `DAYSLEFT` can still stop it. A common block has no `DAYS` line and no day of its own, so it is dropped, including a `NEXT` entry without weekdays.

`ESTIVI MODE` names the piece that follows: the short mode, then an optional `WELCOME`, `BUMPER PRE`, `BUMPER POST`, or `BYE`. The visor joins that to the program name (`Noticias · Welcome`). The label lasts 20 seconds and is used when the picture locks. VIS chooses the mode. An unknown short still labels the piece. Auto ignores a VIS code that is not in the table below. A manual mode forces that mode's line timing. A picture can also start mid-image, with no VIS: the decoder locks onto four line syncs of a known mode and receives the rest of that picture. Manual uses the mode in the box; Auto uses the last mode received. With no last mode, Auto waits for the next VIS. The missed top of the picture is not reconstructed.

Sync is 1200 Hz, black 1500 Hz, white 2300 Hz.

| Mode | VIS |
|---|---|
| Martin M1, M2, M3, M4 | `0x2c` `0x28` `0x24` `0x20` |
| Scottie S1, S2, DX | `0x3c` `0x38` `0x4c` |
| Robot 24, 36, 72, 12 | `0x04` `0x08` `0x0c` `0x00` |
| Robot 8, 12, 24 B/N | `0x02` `0x06` `0x0a` |
| PD 50, 90, 120, 160, 180, 240, 290 | `0x5d` `0x63` `0x5f` `0x62` `0x60` `0x61` `0x5e` |
| YoniQ | `0x73`, odd parity |

Martin M3 and M4 send half the rows and each row is shown twice. YoniQ takes chroma from the even row. Robot 36 and Robot 12 use the line parity, even for Cr. Scottie keeps the extra 9 ms of 1200 Hz sync after the VIS.

Only the analog YoniQ mode is decoded. The former DGT YQ clean-copy button, its FTP process, and the `/dgt/` proxy are gone.

## Files

`www/` is the page. The compose file publishes it on host port 8086; inside the container nginx serves it on 80, with `nginx.conf` sending `no-cache` for HTML, JS, and CSS. `test/` builds synthetic Estivi audio and checks the demodulator, the line times, AX.25 at 48000 and 44100, a picture at about −35 dB, mid-image starts, lost-signal recovery, translations, and the guide. Those tests are not copied into the image.

Everything the page remembers is in IndexedDB under the database name `estivi rx`: the pictures as lossless PNG blobs, newest first and capped at 40, plus the guide and the preferences. Deleting one picture removes only that one; clearing the pictures does not clear the guide, and clearing the guide does not touch the pictures.

## License

IBM Plex Sans and IBM Plex Mono in `www/fonts/` are SIL Open Font License 1.1 (`www/fonts/OFL.txt`).
