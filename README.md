# Estivi RX

Estivi RX is the browser receiver for [Estivi](https://github.com/fluoroom/estivi-tx). It listens to the audio from your radio through the microphone, decodes the AX.25 messages and the SSTV pictures the transmitter sends, and draws them on one page. Everything runs in the browser: there is no decoder on the server, and the Docker container only serves the static files.

## Run it

```sh
docker compose up --build
```

Then open [http://localhost:8086](http://localhost:8086). The page asks for the microphone and starts receiving on its own. If you deny the permission it stays quiet; press **Start receiving** and it will tell you why.

A browser only gives a page the microphone over HTTPS or on localhost, so keep that in mind when you put it on a server.

To leave it running:

```sh
docker compose up -d --build
```

The container restarts unless you stop it by hand. It serves plain HTTP on host port 8086; put your nginx in front for TLS and headers.

To check the decoder without a microphone:

```sh
npm test
```

## A tour of the page

### The header

The header is where you set things up. From left to right:

- the title and a local clock with seconds, with a small UTC clock underneath;
- the input device, and **Mono / Left / Right**;
- input gain, from −12 dB to +36 dB in 0.5 dB steps — the slider turns red above 0 dB;
- the level meter, about −42 dB to 0 dB;
- the SSTV mode, and **Start / Stop receiving**;
- the theme button, which names the theme you switch to (Light while the page is dark, Dark while it is light; dark is the default);
- the language selector.

The page starts in English, or in Spanish when the browser prefers Spanish. The selector offers Auto, English and Español, and its Auto option follows the browser again. A forced choice is saved with the other preferences.

### The visor

The visor is the picture. Its shape follows the mode that is decoding; with nothing arriving it is 320×256. It is scaled to fit the window and the whole frame stays visible.

Under the picture, still outside it, are the program or image name with the mode in a smaller grey label after it, the resize style button (**Blur / Pixels**), **Save**, **Delete**, **Fullscreen** and **Reset**. Delete only appears for a saved picture, and it asks before removing that one picture. Color is decoded to full-range RGB, the transmitter's default, with no studio-range switch.

**Blur** is the default: it smooths the received picture up to the visor size. **Pixels** keeps each received pixel a hard block. The button names the mode you get if you click it, so it reads Pixels while Blur is on and Blur while Pixels is on; hovering it says *Resize style*. Timeline thumbnails stay sharp pixels either way.

**Save** writes the received pixels as a lossless PNG named `estivi-rx-YY-MM-DD-HH-mm-MODE.png`, using the save time and the picture's mode short code. It does not include the grain or the enlargement.

**Grain** lives only on the live view. It fills the visor when nothing is arriving and the rows that have not been revealed yet while a picture is coming in. A finished picture, a picture stopped halfway, a saved thumbnail and the Save file have none.

### The timeline

The first slot is always the live decoder. Clicking it, or Reset, puts the big visor back on live. Clicking a saved picture shows that picture until Reset, another picture, the live slot, or a new reception.

A new reception shows the live picture as it arrives, then holds the finished image. The copy is stored when the reception ends and becomes the second timeline entry. The thin receive marks on the hour row open the same saved picture.

If the signal disappears during a picture, the page holds the partial picture and keeps looking for the same mode's lines for 30% of that mode's picture time. If the signal returns, the picture continues from where it now is and the lines lost in between stay empty. If it does not return in time, the partial picture is saved to the timeline and the visor goes back to live view.

Reset gives up on the partial picture too, but only once the signal has been gone for 30% of that window (10.3 s for Martin M1, 3.2 s for Robot 36, 11.3 s for PD 120, 6.3 s for YoniQ); before then it just changes the view. A new VIS also ends the partial picture and starts the next one.

The timeout is per mode: 34.3 s for Martin M1, 10.8 s for Robot 36, 37.8 s for PD 120, and 21.0 s for YoniQ. **Clear image memory** asks before it drops every picture and leaves the schedule alone.

### The hour row

Under the timeline, the hour row starts at the top of the current hour and runs until 12 hours after the last program still on today's guide. That window stays put so the yellow line can travel with the clock, and it is pinned again when the clock leaves it. A thin mark sits on each saved picture whose receive time falls inside the row. The same clock hour can appear twice when the row crosses midnight.

### The calendar

Calendar opens today and the next 30 days and shows only the days that have programs. Each card is headed with the weekday, day and month, so the window runs from, say, 7 Nov to 7 Dec.

A program that crosses midnight stays one entry, `23:30–00:30`, and is not cut at 00:00; the hour row draws it as one block too, and a block still running after midnight also appears on today's card. Only blocks that overlap share lanes: two overlapping programs are split side by side, while a block with nothing beside it takes the full height in the hour row and the full width in the calendar. Same-callsign overlaps split the same way. **Clear calendar** asks before it deletes every program.

The footer reads `LU1AQY 2026` and links to [lu1aqy.radio](https://lu1aqy.radio). The page title is `estivi rx`.

## What it receives

Audio goes through a gain stage into an AudioWorklet, which demodulates the tone. AX.25 and SSTV run on the page from that frequency stream. Playback through the speakers is off, and the browser's echo cancellation, noise reduction and automatic gain are off too.

### AX.25

AX.25 is 1200 baud Bell 202, the way Estivi sends it: mark 1200 Hz, space 2200 Hz, NRZI, LSB first, with a stuffed 0 after five 1s.

A frame is kept when it is addressed to `ESTIVI`, the control byte is UI (`0x03`), the PID is `0xF0`, and the CRC residue is `0xF0B8`. The text is either `ESTIVI 1` or `ESTIVI MODE`.

### The guide

An info frame carries the lines from `AX25.md` in the transmitter: `FREQ`, `CALL`, `NAME`, `RANGE`, `DAYS`, `DAYSLEFT`, `NEXT` and `COMMENT`. Unknown lines are ignored, and so is any text that does not start with `ESTIVI `. `COMMENT` is kept on the packet but not shown.

The frame has no date and no timezone: `HH:MM` is UTC, and the weekdays are the English abbreviations the transmitter sends (`Mon` … `Sun`). The calendar shows the local weekday in the page language. The guide stores the UTC rule and places it on this computer's local calendar, so the hour row, the calendar and the main clock show local time while the small clock in the header shows UTC.

A program with weekdays is placed on those days. `DAYSLEFT` counts from the local day it was heard, including that day; `0` means no end, and the largest value is `99`. A program stays in the guide until the calendar is cleared, even if it is not heard again; its own `DAYSLEFT` can still stop it. A common block has no `DAYS` line and no day of its own, so it is dropped, including a `NEXT` entry without weekdays.

### Labels

`ESTIVI MODE` names the piece that follows: the short mode, then an optional `WELCOME`, `BUMPER PRE`, `BUMPER POST` or `BYE`. The visor joins that to the program name (`Noticias · Welcome`). The label lasts 20 seconds and is used when the picture locks. An unknown short still labels the piece.

### Picking the mode

VIS chooses the mode. Auto ignores a VIS code that is not in the table below; a manual mode forces that mode's line timing. A picture can also start mid-image, with no VIS: the decoder locks onto four line syncs of a known mode and receives the rest of that picture. Manual uses the mode in the box; Auto uses the last mode received, and with no last mode it waits for the next VIS. The missed top of the picture is not reconstructed.

Sync is 1200 Hz, black 1500 Hz, white 2300 Hz.

| Mode | VIS |
|---|---|
| Martin M1, M2, M3, M4 | `0x2c` `0x28` `0x24` `0x20` |
| Scottie S1, S2, DX | `0x3c` `0x38` `0x4c` |
| Robot 24, 36, 72, 12 | `0x04` `0x08` `0x0c` `0x00` |
| Robot 8, 12, 24 B/N | `0x02` `0x06` `0x0a` |
| PD 50, 90, 120, 160, 180, 240, 290 | `0x5d` `0x63` `0x5f` `0x62` `0x60` `0x61` `0x5e` |
| YoniQ | `0x73`, odd parity |

A few modes have their own habits: Martin M3 and M4 send half the rows and each row is shown twice; YoniQ takes chroma from the even row; Robot 36 and Robot 12 use the line parity, even for Cr; and Scottie keeps the extra 9 ms of 1200 Hz sync after the VIS.

Only the analog YoniQ mode is decoded. The former DGT YQ clean-copy button, its FTP process and the `/dgt/` proxy are gone.

## Files, tests and storage

`www/` is the page. The compose file publishes it on host port 8086; inside the container nginx serves it on 80, with `nginx.conf` sending `no-cache` for HTML, JS and CSS.

`test/` builds synthetic Estivi audio and checks the demodulator, the line times, AX.25 at 48000 and 44100, a picture at about −35 dB, mid-image starts, lost-signal recovery, translations and the guide. Those tests are not copied into the image.

Everything the page remembers lives in IndexedDB under the database name `estivi rx`: the pictures as lossless PNG blobs, newest first and capped at 40, plus the guide and the preferences (device, channel, gain, SSTV mode, the last mode actually received, theme, scaling choice and language). Deleting one picture removes only that one; clearing the pictures does not clear the guide, and clearing the guide does not touch the pictures.

## License

IBM Plex Sans and IBM Plex Mono in `www/fonts/` are SIL Open Font License 1.1 (`www/fonts/OFL.txt`).
