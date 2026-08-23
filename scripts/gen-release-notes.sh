#!/usr/bin/env bash
#
# gen-release-notes.sh — リリースノートの本文を生成する
#
# 依存ゼロ・通信ゼロ（git と POSIX テキストツールのみ）。
#
#   scripts/gen-release-notes.sh [X.Y.Z] [BASE] [--stdout] [--from-commits]
#
#   X.Y.Z … 生成するバージョン。省略時は現在ブランチ名 release/Ver_X.Y.Z から導出する。
#   BASE  … 比較の基準（タグ Ver_a.b.c か、バージョン a.b.c）。省略時は
#           「HEAD の祖先 Ver_* タグを SemVer で並べた最上位（= 直前の公開版）」を自動選択する。
#
# 本文は CHANGELOG.md からそのまま使う。対象バージョンの見出し（リリース時は
# release-changelog.mjs が先に切り出す）を優先し、無ければ [Unreleased] を読む。
# CHANGELOG は英語で手書きしているため、リリースノートも英語で出る。
# --from-commits を渡すか、どちらの節も空のときはコミットからの自動生成に落ちる。
# フォールバックは Conventional Commits の prefix で分類し、ユーザー向けの feat / fix
# のみ拾う（docs/chore/ci/test 等はノイズとして落とす）。prefix と scope は除去する。
#
# 既定では docs/release-notes/X.Y.Z.md へ書き出す（既存なら上書き前に確認）。--stdout で標準出力のみ。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TO_STDOUT=0
FROM_COMMITS=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --stdout) TO_STDOUT=1 ;;
    --from-commits) FROM_COMMITS=1 ;;
    -h|--help) sed -n '3,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) ARGS+=("$a") ;;
  esac
done
if [[ ${#ARGS[@]} -gt 0 ]]; then set -- "${ARGS[@]}"; else set --; fi

VERSION="${1:-}"
BASE_ARG="${2:-}"

# --- バージョンの解決 -------------------------------------------------------
if [[ -z "$VERSION" ]]; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "$branch" =~ ^release/Ver_([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
    VERSION="${BASH_REMATCH[1]}"
  else
    echo "error: バージョンを指定するか release/Ver_X.Y.Z ブランチで実行してください（現在: ${branch}）" >&2
    exit 1
  fi
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: バージョンは X.Y.Z 形式で指定してください（受領: ${VERSION}）" >&2
  exit 1
fi

# --- a < b（SemVer, sort -V 準拠）------------------------------------------
ver_lt() {  # ver_lt a b -> 真なら a < b
  [[ "$1" != "$2" ]] && [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" == "$1" ]]
}

# --- 比較基準（BASE）の解決 -------------------------------------------------
BASE_REF=""
if [[ -n "$BASE_ARG" ]]; then
  # タグ名そのもの、もしくは a.b.c（→ Ver_a.b.c）を受け付ける
  if git rev-parse -q --verify "refs/tags/$BASE_ARG" >/dev/null; then
    BASE_REF="$BASE_ARG"
  elif git rev-parse -q --verify "refs/tags/Ver_$BASE_ARG" >/dev/null; then
    BASE_REF="Ver_$BASE_ARG"
  else
    echo "error: 基準タグが見つかりません: $BASE_ARG" >&2
    exit 1
  fi
else
  # HEAD の祖先 Ver_* タグのうち、対象版 未満で最上位のものを選ぶ
  best=""
  while IFS= read -r tag; do
    [[ -z "$tag" ]] && continue
    v="${tag#Ver_}"
    ver_lt "$v" "$VERSION" || continue          # 対象版以上（自身の再生成等）は除外
    if [[ -z "$best" ]] || ver_lt "${best#Ver_}" "$v"; then best="$tag"; fi
  done < <(git tag --merged HEAD 'Ver_*')
  BASE_REF="$best"
fi

if [[ -n "$BASE_REF" ]]; then
  RANGE="$BASE_REF..HEAD"
  BASE_LABEL="$BASE_REF"
else
  RANGE="HEAD"                                   # 初回リリース: 全履歴
  BASE_LABEL="(初回)"
fi

# --- コミット収集・分類 -----------------------------------------------------
# prefix（type と任意の (scope)、! を含む）を剥がして説明本文だけ残す
strip_prefix='s/^[a-z]+(\([^)]*\))?!?: *//'
# 既存の squash 済み履歴には1行に複数コミットが連結した subject がある
#（例: "feat: A chore: B"）。行内の埋め込み prefix ごと分割して1件ずつにする。
split_embedded='s/ +((feat|fix|chore|docs|refactor|ci|test|style|perf|build)(\([^)]*\))?!?:)/\n\1/g'

feats="$(git log --no-merges --format='%s' $RANGE \
          | sed -E "$split_embedded" \
          | grep -E '^feat(\([^)]*\))?!?:' || true)"
fixes="$(git log --no-merges --format='%s' $RANGE \
          | sed -E "$split_embedded" \
          | grep -E '^fix(\([^)]*\))?!?:'  || true)"

to_bullets() { [[ -n "$1" ]] && printf '%s\n' "$1" | sed -E "$strip_prefix" | sed 's/^/- /'; }

# --- CHANGELOG.md の本文 ----------------------------------------------------
# 見出し行の次から、次の "## " 見出し（または末尾のリンク定義）の手前までを取り出す。
# 前後の空行は落とす。箇条書きが 1 つも無ければ「空」とみなす。
changelog_section() {   # $1 = 見出しの先頭一致文字列（例: "## [Unreleased]"）
  [[ -f CHANGELOG.md ]] || return 0
  # awk -v は値の \ をエスケープとして解釈するため、正規表現ではなく前方一致で判定する
  # （"## [0.2.0]" は "## [0.2.0] - 2026-08-23" にも一致する）。
  awk -v head="$1" '
    !inside && substr($0, 1, length(head)) == head { inside = 1; next }
    inside && /^## /                               { exit }
    inside && /^\[[^]]+\]:[[:space:]]/             { exit }
    inside                                         { print }
  ' CHANGELOG.md | sed -e '/./,$!d' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
}

has_bullet() { grep -qE '^[-*] ' <<<"${1:-}"; }

CHANGELOG_BODY=""
CHANGELOG_FROM=""
if [[ "$FROM_COMMITS" == "0" ]]; then
  # リリースでは release-changelog.mjs が先に [Unreleased] を切り出すため、
  # まず対象バージョンの見出しを探し、無ければ [Unreleased] を見る。
  CHANGELOG_BODY="$(changelog_section "## [${VERSION}]")"
  if has_bullet "$CHANGELOG_BODY"; then
    CHANGELOG_FROM="[${VERSION}]"
  else
    CHANGELOG_BODY="$(changelog_section '## [Unreleased]')"
    if has_bullet "$CHANGELOG_BODY"; then
      CHANGELOG_FROM="[Unreleased]"
    else
      CHANGELOG_BODY=""
    fi
  fi
fi

# --- 出力 -------------------------------------------------------------------
render_body_from_commits() {
  if [[ -n "$feats" ]]; then
    echo "### Features"
    to_bullets "$feats"
    echo
  fi
  if [[ -n "$fixes" ]]; then
    echo "### Fixes"
    to_bullets "$fixes"
    echo
  fi
  if [[ -z "$feats" && -z "$fixes" ]]; then
    echo "- No user-facing changes."
    echo
  fi
}

render() {
  echo "## What's Changed"
  echo
  if [[ -n "$CHANGELOG_BODY" ]]; then
    printf '%s\n\n' "$CHANGELOG_BODY"
  else
    render_body_from_commits
  fi
  echo "## Install"
  echo
  echo "Download \`terminal-for-ai-cli-<version>.vsix\` and run:"
  echo
  echo '```bash'
  echo "code --install-extension terminal-for-ai-cli-<version>.vsix"
  echo '```'
}

# 空入力で grep -c が exit 1 しつつ "0" を出すため、行数は自前で数える
line_count() { [[ -z "${1:-}" ]] && echo 0 || printf '%s\n' "$1" | wc -l | tr -d '[:space:]'; }
if [[ -n "$CHANGELOG_BODY" ]]; then
  SOURCE="CHANGELOG.md の ${CHANGELOG_FROM}"
else
  SOURCE="コミット（feat $(line_count "$feats") / fix $(line_count "$fixes")）"
fi
echo "terminal-for-ai-cli: $VERSION  基準=$BASE_LABEL  range=$RANGE  情報源=$SOURCE" >&2

if [[ "$TO_STDOUT" == "1" ]]; then
  render
  exit 0
fi

OUT="docs/release-notes/${VERSION}.md"
if [[ -e "$OUT" ]]; then
  read -r -p "既に存在します: $OUT 上書きしますか? [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || { echo "中止しました。"; exit 1; }
fi
mkdir -p "$(dirname "$OUT")"
render > "$OUT"
echo "書き出し: $OUT" >&2
