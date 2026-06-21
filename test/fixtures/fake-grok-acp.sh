#!/bin/sh
exec node "$(dirname "$0")/fake-grok-acp.cjs" "$@"
