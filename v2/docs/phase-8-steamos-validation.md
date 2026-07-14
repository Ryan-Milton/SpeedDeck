# SteamOS Installer And Hardware Validation

This document defines the Phase 8 on-Deck validation required before claiming SteamOS support.
It is a test matrix, not a claim that a particular Deck, dock, receiver, or SteamOS build has been
validated. Record the actual results with the release artifact SHA-256.

## Secure Installation Check

Run these steps in Desktop Mode as the logged-in Deck user. The receiver must be connected directly
or through the intended dock before identifying it.

```bash
cd v2
lsusb
# Copy the exact ID printed as `ID VID:PID`; do not configure a vendor-only rule.
./scripts/setup-steamos.sh --dry-run --receiver VID:PID /path/to/SpeedDeck.AppImage
./scripts/setup-steamos.sh --receiver VID:PID /path/to/SpeedDeck.AppImage
# Unplug and reconnect the receiver, then:
./scripts/setup-steamos.sh --check --receiver VID:PID
```

`067b:2303` is the only installer default and applies to the v1 Prolific PL2303 receiver. For every
other receiver, pass its own exact ID with `--receiver` or set
`SPEEDDECK_RECEIVER_VID_PID=VID1:PID1,VID2:PID2`. Multiple configured IDs are allowed only when each
receiver is intended for SpeedDeck.

Expected installation properties:

- `/etc/udev/rules.d/72-speeddeck-gps.rules` loads before `73-seat-late.rules`, contains exact
  `idVendor` and `idProduct` matches with `TAG+="uaccess"`, and has no `RUN+=` action.
- The installer removes the legacy `/etc/udev/rules.d/99-speeddeck-gps.rules` file.
- `~/.config/systemd/user/speeddeck.service` has no `[Install]` section. `systemctl --user is-enabled
  speeddeck.service` must not report `enabled`.
- The receiver is readable and writable only from the active local session after reconnecting. The
  diagnostic enumerates `/sys/class/tty` and must fail if a connected configured USB receiver has no
  matching accessible tty. If it reports no access, confirm that it is run from the graphical
  Desktop-Mode user session, reconnect the device, then inspect `udevadm info --query=property
  --path=/sys/class/tty/<name>` for the configured IDs.
- Start explicitly with `~/Applications/SpeedDeck.AppImage` or
  `systemctl --user start speeddeck.service`. Do not use `--no-sandbox` as a Steam launch option.

## Deck Hardware Matrix

Record Deck model (LCD/OLED), SteamOS build, kernel, AppImage SHA-256, GNSS make/model and VID:PID,
dock/hub model and firmware, charger rating, battery percentage at start/end, test operator, and
pass/fail evidence for every row. Capture relevant `journalctl --user -u speeddeck.service` output
and the installer `--check` output when a row fails.

| Area | Deck setup and procedure | Pass criteria | Evidence to record |
| --- | --- | --- | --- |
| Direct USB-C receiver | Boot Desktop Mode. Connect the receiver directly to the Deck, reconnect once after install, run `--check`, then launch manually. | Exact receiver is reported accessible; NMEA position progresses after a normal fix; no launch occurs merely on plug-in. | `lsusb`, `--check`, port path, time to first fix. |
| Dock or hub receiver | Repeat using every supported dock/hub and USB-A adapter, first on Deck battery and then with its intended power supply. | Receiver remains accessible across reconnects; app uses the re-enumerated port without a restart; unrelated USB serial devices do not receive the rule. | Dock/hub model, ports used, `lsusb`, result after each reconnect. |
| Charging passthrough | With the receiver attached through the dock/hub, attach the production charger. Observe the SteamOS charging indicator and battery level for 30 minutes while SpeedDeck is running. Repeat with receiver disconnected. | Charging is reported and battery does not drain under the agreed workload; receiver data remains live while charge state changes. | Charger rating, start/end battery %, charge state, any USB resets. |
| Hotplug and disconnect | With SpeedDeck already manually running, unplug the receiver for at least 30 seconds, reconnect it, and repeat five times. Also leave it disconnected before launching the app. | App remains usable with a disconnected indication, reconnects without relaunch, and no service/app starts when the receiver is plugged in while the app is closed. | Five reconnect outcomes, elapsed reconnect time, logs on failure. |
| Suspend and resume | Run with a live fix, suspend from the Deck power button for 2 minutes, resume, then repeat for 30 minutes. Test once on battery and once with charging passthrough. | No root-launched process appears; app resumes or visibly reconnects without manual permission repair; a new valid fix is obtained. | Suspend duration, resume-to-fix time, charge state, `--check` result. |
| Desktop session boundary | Close SpeedDeck, log out or reboot, log back into Desktop Mode with the receiver connected, and inspect service state before launching it. | `speeddeck.service` is not enabled or active until the user launches it; device access is restored to the active session after reconnect if required by logind. | `systemctl --user is-enabled`, `systemctl --user is-active`, `--check`. |
| Gaming Mode manual launch | Add the installed AppImage as a Non-Steam Game and launch with no launch options. Connect/disconnect the receiver while running. | App launches without `--no-sandbox`; receiver behavior matches the supported permission model or any limitation is recorded as a release blocker. | SteamOS build, launch options (empty), hotplug outcome. |
| Endurance route | Use the production receiver, mount, power path, and display/TDP settings on a representative route or a stationary sky-view run for at least 2 hours. Include at least one disconnect/reconnect and one suspend/resume if safe. | No crash, unbounded memory/CPU growth, loss of receiver permission, or battery/charging regression; GPS/trip data behavior remains coherent. | Duration, route/fix coverage, battery %, thermals, logs, artifact SHA-256. |

Treat a failure in the direct receiver, charging passthrough, session-boundary, or endurance rows as a
release blocker for the corresponding hardware configuration. Do not broaden the udev rule to work
around a failed receiver: identify and configure its exact VID:PID, then repeat the affected tests.
