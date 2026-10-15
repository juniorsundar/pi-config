#!/bin/sh
set -eu

resolve_link() (
  path=$1
  depth=0
  while [ -L "$path" ]; do
    depth=$((depth + 1))
    [ "$depth" -le 40 ] || return 1
    target=$(readlink "$path") || return 1
    case "$target" in
      /*) path=$target ;;
      *) path=${path%/*}/$target ;;
    esac
  done
  [ -e "$path" ] || return 1
  cd "${path%/*}" || return 1
  printf '%s/%s\n' "$(pwd -P)" "${path##*/}"
)

profile_dir=$(cd "$(dirname "$0")" && pwd -P)
managed=$profile_dir/../bin/pi
shim=$profile_dir/pi
link=$HOME/.local/bin/pi

if [ ! -x "$managed" ] || [ ! -x "$shim" ] || [ ! -L "$link" ]; then
  printf 'Expected an installed Pi launcher symlink at %s\n' "$link" >&2
  exit 1
fi
current=$(resolve_link "$link") || {
  printf 'Refusing to replace an unexpected Pi launcher: %s\n' "$link" >&2
  exit 1
}
if [ "$current" = "$(resolve_link "$shim")" ]; then
  exit 0
fi
if [ "$current" != "$(resolve_link "$managed")" ]; then
  printf 'Refusing to replace an unexpected Pi launcher: %s\n' "$link" >&2
  exit 1
fi
ln -sfn "$shim" "$link"
