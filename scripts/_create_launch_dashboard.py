#!/usr/bin/env python3
"""
Create the parkproof-launch CloudWatch Dashboard.

One bookmark, six widgets — the signal surface for the Reddit launch:
  1. Lambda invocations + errors (per-minute combined chart)
  2. Lambda duration p50/p90/p99 (latency tracking)
  3. Async-polling job latency from anthropic_call= log lines
  4. AI feedback accept-vs-retake tally (recent 24h)
  5. Free-text user feedback live tail (most recent messages)
  6. Async-polling job status events (pending / done / error mix)

Idempotent — re-running PutDashboard overwrites the previous spec.

Run:
  python scripts/_create_launch_dashboard.py
"""
import json
import subprocess
import sys

REGION = "ap-southeast-2"
DASHBOARD_NAME = "parkproof-launch"
LAMBDA = "parkproof-sign-translator"
LOG_GROUP = f"/aws/lambda/{LAMBDA}"


def widget_metric(x, y, w, h, title, metrics, *, view="timeSeries", stat=None, period=60, y_left_max=None):
    """Helper for a metric widget."""
    props = {
        "metrics": metrics,
        "view": view,
        "region": REGION,
        "title": title,
        "period": period,
        "stacked": False,
    }
    if stat:
        props["stat"] = stat
    if y_left_max is not None:
        props["yAxis"] = {"left": {"min": 0, "max": y_left_max}}
    else:
        props["yAxis"] = {"left": {"min": 0}}
    return {"type": "metric", "x": x, "y": y, "width": w, "height": h, "properties": props}


def widget_log(x, y, w, h, title, query, *, view="table"):
    """Helper for a Logs Insights widget."""
    return {
        "type": "log",
        "x": x,
        "y": y,
        "width": w,
        "height": h,
        "properties": {
            "query": f"SOURCE '{LOG_GROUP}' | {query}",
            "region": REGION,
            "title": title,
            "view": view,
        },
    }


def widget_text(x, y, w, h, markdown):
    return {
        "type": "text",
        "x": x,
        "y": y,
        "width": w,
        "height": h,
        "properties": {"markdown": markdown},
    }


# ─── Build the widget grid ───────────────────────────────────────────────────
# CloudWatch dashboards are a 24-column grid. Standard widget is 12×6.
widgets = []

# Row 0 — header banner (full width)
widgets.append(
    widget_text(
        0,
        0,
        24,
        2,
        (
            "# ParkProof — Reddit launch console\n\n"
            "Single tab to keep open during the launch window. "
            "All widgets auto-refresh on the global dashboard timer (default 1 min). "
            "If anything looks red, see `CLAUDE.md > Rollback playbook` for triage."
        ),
    )
)

# Row 1 — Lambda volume + error rate
widgets.append(
    widget_metric(
        0,
        2,
        12,
        6,
        "Lambda — invocations & errors (per minute)",
        [
            ["AWS/Lambda", "Invocations", "FunctionName", LAMBDA, {"stat": "Sum"}],
            [".", "Errors", ".", ".", {"stat": "Sum", "color": "#d62728"}],
            [".", "Throttles", ".", ".", {"stat": "Sum", "color": "#ff7f0e"}],
        ],
        period=60,
    )
)
widgets.append(
    widget_metric(
        12,
        2,
        12,
        6,
        "Lambda — duration percentiles (ms)",
        [
            ["AWS/Lambda", "Duration", "FunctionName", LAMBDA, {"stat": "p50"}],
            ["...", {"stat": "p90"}],
            ["...", {"stat": "p99", "color": "#d62728"}],
            ["...", {"stat": "Maximum", "color": "#666666"}],
        ],
        period=60,
    )
)

# Row 2 — Anthropic latency from structured logs + free-text feedback tail
widgets.append(
    widget_log(
        0,
        8,
        12,
        6,
        "Anthropic latency over time (1-min buckets)",
        (
            "filter @message like 'anthropic_call=' "
            "| parse @message /anthropic_call=(?<ms>\\d+)ms.*?mode=(?<mode>\\w+)/ "
            "| stats avg(ms), pct(ms, 90), max(ms) by bin(1m), mode "
            "| sort @timestamp desc"
        ),
        view="timeSeries",
    )
)
widgets.append(
    widget_log(
        12,
        8,
        12,
        6,
        "User feedback (free-text) — newest first",
        (
            "filter @message like '[parkproof.user_feedback]' "
            "| parse @message /\"message\":\"(?<msg>[^\"]+)\"/ "
            "| parse @message /\"page\":\"(?<page>[^\"]+)\"/ "
            "| parse @message /\"email\":\"(?<email>[^\"]+)\"/ "
            "| display @timestamp, page, email, msg "
            "| sort @timestamp desc "
            "| limit 25"
        ),
    )
)

# Row 3 — AI verdict tally + verdict-by-confidence breakdown
widgets.append(
    widget_log(
        0,
        14,
        12,
        6,
        "AI feedback — accept vs retake counts",
        (
            "filter @message like '[parkproof.feedback]' "
            "| parse @message /\"verdict\":\"(?<verdict>[a-z]+)\"/ "
            "| stats count() as events by verdict "
            "| sort events desc"
        ),
    )
)
widgets.append(
    widget_log(
        12,
        14,
        12,
        6,
        "Retake rate by AI confidence — surfaces \"wrongly-confident\" failures",
        (
            "filter @message like '[parkproof.feedback]' "
            "| parse @message /\"verdict\":\"(?<verdict>[a-z]+)\"/ "
            "| parse @message /\"confidence\":\"(?<confidence>[a-z]+)\"/ "
            "| stats count() as events, sum(verdict = 'retake') as retakes by confidence "
            "| display confidence, events, retakes, retakes / events * 100 as retake_pct"
        ),
    )
)

# Row 4 — async job mix + S3 user_feedback errors
widgets.append(
    widget_log(
        0,
        20,
        12,
        6,
        "Async job outcomes (sign-translate + draft-appeal)",
        (
            "filter @message like 'job_id=' "
            "| parse @message /status=(?<status>\\w+)/ "
            "| stats count() as events by status "
            "| sort events desc"
        ),
    )
)
widgets.append(
    widget_log(
        12,
        20,
        12,
        6,
        "Error pulse — anything tagged WARN / ERROR / failed",
        (
            "filter @message like 'ERROR' or @message like 'WARN' "
            "or @message like 'failed' or @message like 'dispatch.failed' "
            "| display @timestamp, @message "
            "| sort @timestamp desc "
            "| limit 30"
        ),
    )
)


dashboard_body = {"widgets": widgets}

cmd = [
    "aws",
    "cloudwatch",
    "put-dashboard",
    "--dashboard-name",
    DASHBOARD_NAME,
    "--dashboard-body",
    json.dumps(dashboard_body),
    "--region",
    REGION,
]
result = subprocess.run(cmd, capture_output=True, text=True)
if result.returncode != 0:
    print("FAILED:", result.stderr, file=sys.stderr)
    sys.exit(1)
print(result.stdout or "(no output — success)")

# Print the dashboard URL for easy bookmarking
print()
print("Dashboard URL (bookmark this):")
print(
    f"  https://{REGION}.console.aws.amazon.com/cloudwatch/home"
    f"?region={REGION}#dashboards:name={DASHBOARD_NAME}"
)
