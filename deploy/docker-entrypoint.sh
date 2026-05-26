#!/bin/sh
set -e

if [ "$#" -eq 0 ]; then
  set -- /renewlet
elif [ "${1#-}" != "$1" ]; then
  set -- /renewlet "$@"
elif [ "$1" = "serve" ] || [ "$1" = "superuser" ] || [ "$1" = "healthcheck" ] || [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  set -- /renewlet "$@"
fi

if [ "$(id -u)" = "0" ]; then
  mkdir -p /pb_data /opt/renewlet/current /opt/renewlet/backups
  if [ -e /renewlet ] && [ ! -L /renewlet ]; then
    rm -f /renewlet
  fi
  if [ ! -e /renewlet ]; then
    ln -s /opt/renewlet/current/renewlet /renewlet
  fi
  chown -R renewlet:renewlet /pb_data /opt/renewlet

  if [ "$1" = "/renewlet" ]; then
    exec su-exec renewlet "$@"
  fi
fi

exec "$@"
