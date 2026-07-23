# Shared PATH/JAVA_HOME bootstrap for any script that shells out to `daml`.
# Sourced (not exec'd) so non-interactive shells (CI, fresh terminals without a
# fish/bash rc) get the same env as an interactive shell. Canton's sandbox needs
# both `daml` and a JDK 17 runtime, and fails with cryptic errors otherwise
# ("Unable to locate a Java Runtime").
#
# Overrides for non-Homebrew installs:
#   OVERWRITE_DAML_HOME - directory containing the `daml` binary (default: $HOME/.daml/bin)
#   OVERWRITE_JAVA_HOME - JDK 17 directory; takes precedence over auto-detect

DAML_HOME="${OVERWRITE_DAML_HOME:-$HOME/.daml/bin}"
if [ -d "$DAML_HOME" ]; then
  case ":$PATH:" in
    *":$DAML_HOME:"*) ;;
    *) PATH="$DAML_HOME:$PATH" ;;
  esac
fi

if [ -z "${JAVA_HOME:-}" ]; then
  for candidate in \
    "${OVERWRITE_JAVA_HOME:-}" \
    /usr/local/opt/openjdk@17 \
    /opt/homebrew/opt/openjdk@17 \
    /usr/lib/jvm/java-17-openjdk-amd64 \
    /usr/lib/jvm/java-17-openjdk; do
    if [ -n "$candidate" ] && [ -d "$candidate" ]; then
      export JAVA_HOME="$candidate"
      PATH="$JAVA_HOME/bin:$PATH"
      break
    fi
  done
fi

export PATH
