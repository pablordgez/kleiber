#!/bin/bash
# Fix chrome-sandbox permissions required by the Electron SUID sandbox.
# This script runs as root after the deb package is installed.
chown root "/opt/Kleiber/chrome-sandbox"
chmod 4755 "/opt/Kleiber/chrome-sandbox"
