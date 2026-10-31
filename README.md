# Estivi RX

Estivi RX is the browser receiver for [Estivi](https://github.com/fluoroom/estivi-tx). It listens to the microphone, decodes the AX.25 frames and SSTV pictures that transmitter puts on the air, and draws them on one page. There is no server-side decoder. The Docker container only serves the static files.

Open it with:

```sh
docker compose up --build
```

Then go to http://localhost:8080. The page asks for the microphone and starts receiving on its own. A denied permission on that automatic start stays quiet; pressing Start receiving shows the error.

Decoder checks, with no microphone:

```sh
npm test
```

## The page

The header is the title, the input device, Mono / Left / Right, input gain, the level meter, the SSTV mode, Start / Stop receiving, and the theme button. Gain runs from −12 dB to +36 dB in 0.5 dB steps. The slider turns red above 0 dB. The meter covers about −42 dB to 0 dB. The theme button names the theme you switch to: Light while the page is dark, Dark while it is light. Dark is the default.

The visor is the picture. Its shape follows the mode that is decoding. With nothing arriving it is 320×256. The picture is scaled to fit the window, and the whole frame stays visible. Under it, still outside the picture: the program or image name, Bicubic / Neighbor, Save, DGT YQ, Fullscreen, and Reset.

Neighbor is the default. Each received pixel stays a hard block. Bicubic redraws that same picture up to the visor size. The button names the mode you get if you click it. Timeline thumbnails stay neighbor either way. Save writes the received pixels as a PNG and does not include the grain or the enlargement.

Grain is only on the live view. It fills the visor when nothing is arriving, and it fills the rows that have not been revealed yet while a picture is coming in. A finished picture, a picture stopped halfway, a saved thumbnail, and the Save file have none.

The first timeline slot is always the live decoder. Clicking it, or Reset, puts the big visor back on live. Clicking a saved picture shows that picture until Reset, another picture, the live slot, or a new reception. A new reception shows the live picture as it arrives, then holds the finished image. The copy is stored when the reception ends, and it becomes the second timeline entry. Clear image memory drops the pictures and leaves the schedule.

Under the timeline, the hour row starts at the top of the current hour and runs until 12 hours after the last program still on today's guide. That window stays put so the yellow line can travel with the clock, and it is pinned again when the clock leaves it. A thin mark sits on each saved picture whose receive time falls inside the row. The same clock hour can appear twice when the row crosses midnight. Calendar opens the upcoming programs. If two different callsigns overlap, the hour row splits into one lane per callsign, and that calendar day is split the same way, side by side. The same callsign stays in one lane. The footer is `LU1AQY 2026`.

Device, channel, gain, SSTV mode, theme, and the scaling choice are remembered in this browser, with the pictures and the guide.

## What it receives

Audio goes through a gain stage into an AudioWorklet. The worklet demodulates the tone. AX.25 and SSTV run on the page from that frequency stream. Playback through the speakers is off, and the browser's echo cancellation, noise reduction, and automatic gain are off.

AX.25 is 1200 baud Bell 202, the way Estivi sends it: mark 1200 Hz, space 2200 Hz, NRZI, LSB first, a stuffed 0 after five 1s. A frame is kept when it is addressed to `ESTIVI`, the control byte is UI (`0x03`), the PID is `0xF0`, and the CRC residue is `0xF0B8`. The text is `ESTIVI 1` or `ESTIVI MODE`.

An info frame carries the lines in `AX25.md` of the transmitter: `FREQ`, `CALL`, `NAME`, `RANGE`, `DAYS`, `DAYSLEFT`, `NEXT`, and `COMMENT`. Unknown lines are ignored. Text that does not start with `ESTIVI ` is ignored. `COMMENT` is kept on the packet and is not shown. `HH:MM` is this computer's local time. The frame has no date and no timezone. Weekdays are the English abbreviations the transmitter sends (`Mon` … `Sun`).

A program with weekdays is placed on those days. `DAYSLEFT` counts from the day it was heard, including that day; `0` means no end, and the guide keeps it for 14 days. A station that is not heard again leaves the guide 7 days after the last copy. A common block has no `DAYS` line. It stays on the local date it was heard. A range that crosses midnight continues on the next morning. A `NEXT` entry with no weekdays is listed in the calendar and is not placed on the hour row.

`ESTIVI MODE` names the piece that follows: the short mode, then an optional `WELCOME`, `BUMPER PRE`, `BUMPER POST`, or `BYE`. The visor joins that to the program name (`Noticias · Welcome`). The label lasts 20 seconds and is used when the picture locks. VIS chooses the mode. An unknown short still labels the piece. Auto ignores a VIS code that is not in the table below. A manual mode forces that mode's line timing and still waits for the VIS header.

Color is full-range JPEG YCbCr, the transmitter's default. Sync is 1200 Hz, black 1500 Hz, white 2300 Hz.

| Mode | VIS |
|---|---|
| Martin M1, M2, M3, M4 | `0x2c` `0x28` `0x24` `0x20` |
| Scottie S1, S2, DX | `0x3c` `0x38` `0x4c` |
| Robot 24, 36, 72, 12 | `0x04` `0x08` `0x0c` `0x00` |
| Robot 8, 12, 24 B/N | `0x02` `0x06` `0x0a` |
| PD 50, 90, 120, 160, 180, 240, 290 | `0x5d` `0x63` `0x5f` `0x62` `0x60` `0x61` `0x5e` |
| YoniQ | `0x73`, odd parity |

Martin M3 and M4 send half the rows and each row is shown twice. YoniQ takes chroma from the even row. Robot 36 and Robot 12 use the line parity, even for Cr. Scottie keeps the extra 9 ms of 1200 Hz sync after the VIS.

A YoniQ mode frame may end with fourteen digits, `ddmmyyyyhhnnss`. That is the name of a clean copy of the picture, not a change to the scan. `ESTIVI MODE YQ WELCOME 31102026140509` is still a welcome. A frame without those digits is unchanged.

## DGT YQ

DGT YQ replaces the visor with the clean 320×256 BMP the transmitter stored for that picture. It does not repair rows from the audio. The button acts on the picture in the visor, and only when that picture is YoniQ and a callsign has been heard.

The file name is `@` plus the callsign plus the stamp plus `.BMP`. When the mode frame carried the stamp, the page asks for that one file. A YONIQ transmission does not send the stamp, so the page tries each second from the receive time back four minutes, on the computer's local clock, and keeps the first file that is there.

The page cannot open FTP. The Docker compose file runs a second process that does, and nginx forwards `/dgt/` to it. That process only retrieves names of this shape from `/web/imagenes_ioniq/` on `ioniq.evl.es`. It logs in with the account compiled into YONIQ 1.13.3. The password is folded into that process so the file does not contain it as plain text. `YONIQ_FTP_HOST`, `YONIQ_FTP_USER`, `YONIQ_FTP_PASSWORD`, and `YONIQ_FTP_PATH` override it.

## Files

`www/` is the page. `Dockerfile` and `nginx.conf` serve that directory on port 8080 and send `no-cache` for HTML, JS, and CSS. `proxy/recovery.py` is the FTP fetch. `test/` builds synthetic Estivi audio and checks the demodulator, the line times, AX.25 at 48000 and 44100, a picture at about −35 dB, the recovery name, and the guide. Those tests are not copied into the image.

Pictures are JPEG in `localStorage`, newest first, capped at 40 images or about 4 million characters. The guide and the preferences are separate keys. Clearing the pictures does not clear the guide.

## License

IBM Plex Sans and IBM Plex Mono in `www/fonts/` are SIL Open Font License 1.1 (`www/fonts/OFL.txt`).
