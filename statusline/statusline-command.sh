#!/bin/bash
# Claude Code status line: model | effort | ctx | 5h | wk | folder | branch
# Wraps onto extra lines when the terminal is narrow; important fields come first.
input=$(cat)

j() { printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null; }

GRN=$'\033[32m'; YEL=$'\033[33m'; RED=$'\033[31m'; RST=$'\033[0m'

# color_pct <number> : echoes the colour code for a percentage
color_pct() {
  local p
  p=$(printf '%.0f' "$1" 2>/dev/null) || { printf '%s' "$RST"; return; }
  if [ "$p" -ge 80 ]; then printf '%s' "$RED"
  elif [ "$p" -ge 50 ]; then printf '%s' "$YEL"
  else printf '%s' "$GRN"; fi
}

# bar <pct> : 10-cell progress bar
bar() {
  local p f i out=""
  p=$(printf '%.0f' "$1" 2>/dev/null) || return
  f=$(( (p + 5) / 10 )); [ "$f" -gt 10 ] && f=10
  for ((i=0; i<10; i++)); do [ "$i" -lt "$f" ] && out+="▰" || out+="▱"; done
  printf '%s' "$out"
}

parts=()
tail=()

# 3. Model
model=$(j '.model.display_name')
[ -n "$model" ] && parts+=("$model")

# 4. Effort level only: low / med / high
effort=$(j '.effort.level')
[ "$effort" = "medium" ] && effort="med"
[ -n "$effort" ] && parts+=("$effort")

# 5. Context % used
ctx=$(j '.context_window.used_percentage')
if [ -n "$ctx" ]; then
  parts+=("ctx $(color_pct "$ctx")$(bar "$ctx") $(printf '%.0f' "$ctx")%${RST}")
fi

# 6. 5-hour limit with time left
five=$(j '.rate_limits.five_hour.used_percentage')
if [ -n "$five" ]; then
  s="5h $(color_pct "$five")$(bar "$five") $(printf '%.0f' "$five")%${RST}"
  reset=$(j '.rate_limits.five_hour.resets_at')
  if [ -n "$reset" ]; then
    left=$(( ${reset%.*} - $(date +%s) ))
    if [ "$left" -gt 0 ]; then
      s="$s ($((left / 3600))h$(printf '%02d' $(( (left % 3600) / 60 )))m left)"
    fi
  fi
  parts+=("$s")
fi

# 6b. Running agents (written by the clean-view mod)
sid=$(j '.session_id')
n=0
[ -n "$sid" ] && [ -f "$HOME/.claude/agent-count/$sid" ] && n=$(cat "$HOME/.claude/agent-count/$sid" 2>/dev/null)
n=${n:-0}
if [ "$n" -gt 0 ] 2>/dev/null; then
  parts+=("${GRN}◆ $n agent$([ "$n" -ne 1 ] && echo s)${RST}")
else
  parts+=("◇ 0 agents")
fi

# 7. Weekly limit
week=$(j '.rate_limits.seven_day.used_percentage')
if [ -n "$week" ]; then
  parts+=("wk $(color_pct "$week")$(printf '%.0f' "$week")%${RST}")
fi


# 1. Folder
dir=$(j '.workspace.current_dir')
[ -z "$dir" ] && dir=$(j '.cwd')
if [ -n "$dir" ]; then
  if [ "$dir" = "$HOME" ]; then name="~"; else name=$(basename "$dir"); fi
  tail+=("$name")
fi

# 2. Git branch with * if dirty
if [ -n "$dir" ] && git --no-optional-locks -C "$dir" rev-parse --git-dir >/dev/null 2>&1; then
  branch=$(git --no-optional-locks -C "$dir" symbolic-ref --short HEAD 2>/dev/null \
    || git --no-optional-locks -C "$dir" rev-parse --short HEAD 2>/dev/null)
  if [ -n "$branch" ]; then
    if [ -n "$(git --no-optional-locks -C "$dir" status --porcelain 2>/dev/null | head -n 1)" ]; then
      branch="$branch*"
    fi
    tail+=("$branch")
  fi
fi

parts+=("${tail[@]}")

# Terminal width: COLUMNS, else the controlling tty, else unknown (0 = one line)
width=${COLUMNS:-0}
if [ "$width" -eq 0 ] 2>/dev/null; then
  width=$( { stty size </dev/tty; } 2>/dev/null | awk '{print $2}')
fi
width=${width:-0}
max=$(( width > 10 ? width - 4 : 0 ))

# visible length (strip colour codes)
vlen() { local t; t=$(printf '%s' "$1" | sed $'s/\033\\[[0-9;]*m//g'); printf '%s' "${#t}"; }

line=""; out=""
for p in "${parts[@]}"; do
  if [ -z "$line" ]; then line="$p"; continue; fi
  cand="$line | $p"
  if [ "$max" -gt 0 ] && [ "$(vlen "$cand")" -gt "$max" ]; then
    out="$out$line"$'\n'; line="$p"
  else
    line="$cand"
  fi
done
printf '%s%s\n' "$out" "$line"
