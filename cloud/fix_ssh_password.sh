#!/bin/bash
set -e
F=/etc/ssh/sshd_config.d/50-cloud-init.conf
if grep -q '^PasswordAuthentication yes' "$F"; then
  sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/' "$F"
fi
sshd -t
systemctl reload ssh
sleep 2
sshd -T | grep -E '^(passwordauthentication|permitrootlogin|allowusers)'
