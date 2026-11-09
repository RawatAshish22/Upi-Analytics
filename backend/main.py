from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import pandas as pd
from pathlib import Path
from typing import Optional
import re
import os
from dotenv import load_dotenv
from google import genai

load_dotenv()

# ----------------------------------
# App Setup
# ----------------------------------
app = FastAPI(
    title="UPI Analytics Copilot API",
    description="Backend for UPI Payments Analytics Dashboard",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------------
# Load Data
# ----------------------------------
DATA_DIR = Path(__file__).parent / "data"

try:
    state_df = pd.read_csv(DATA_DIR / "state_transactions.csv")
    category_df = pd.read_csv(DATA_DIR / "transaction_categories.csv")

    # Cleaning
    for df in [state_df, category_df]:
        df["state"] = (
            df["state"]
            .astype(str)
            .str.replace("-", " ", regex=False)
            .str.title()
        )
        df["year"] = pd.to_numeric(df["year"], errors="coerce")
        df["transactions"] = pd.to_numeric(df["transactions"], errors="coerce").fillna(0)
        df["amount"] = pd.to_numeric(df["amount"], errors="coerce").fillna(0)

        # Convert year to integer (this was the main issue)
        df["year"] = df["year"].astype("Int64")  # nullable integer

    print("Data loaded successfully!")
    print("Total rows in state_df:", len(state_df))
    print("Years available:", sorted(state_df["year"].dropna().unique().tolist()))

except Exception as e:
    print("Error loading data:", e)
    state_df = pd.DataFrame()
    category_df = pd.DataFrame()

# ----------------------------------
# Helper function
# ----------------------------------
UNION_TERRITORIES = {
    "andaman & nicobar islands",
    "chandigarh",
    "dadra & nagar haveli & daman & diu",
    "delhi",
    "jammu & kashmir",
    "ladakh",
    "lakshadweep",
    "puducherry",
}

def filter_data(year: Optional[int] = None, states: Optional[list] = None):
    filtered_state = state_df.copy()
    filtered_category = category_df.copy()

    if year is not None:
        filtered_state = filtered_state[filtered_state["year"] == year]
        filtered_category = filtered_category[filtered_category["year"] == year]

    if states is not None:
        filtered_state = filtered_state[filtered_state["state"].isin(states)]
        filtered_category = filtered_category[filtered_category["state"].isin(states)]

    return filtered_state, filtered_category

# ----------------------------------
# Routes
# ----------------------------------
@app.get("/")
def home():
    return {
        "message": "UPI Analytics Copilot Backend is running!",
        "status": "success"
    }

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.get("/api/years")
def get_years():
    years = sorted(state_df["year"].dropna().unique().tolist(), reverse=True)
    # Convert to normal int for JSON
    years = [int(y) for y in years]
    return {"years": years}

@app.get("/api/states")
def get_states():
    states = sorted(state_df["state"].dropna().unique().tolist())
    return {"states": states}

@app.get("/api/kpis")
def get_kpis(
    year: Optional[int] = Query(None),
    states: Optional[str] = Query(None),
    all_years: bool = Query(False),
):
    if all_years:
        year = None
    state_list = states.split(",") if states is not None and states else ([] if states is not None else None)
    filtered_state, _ = filter_data(year, state_list)

    if filtered_state.empty:
        return {
            "total_transactions": 0,
            "total_amount_crore": 0,
            "states_covered": 0,
            "regions_covered": 0,
            "quarterly_transactions": [],
            "quarterly_amount_crore": [],
            "quarterly_states_covered": [],
        }

    total_transactions = int(filtered_state["transactions"].sum())
    total_amount_crore = round(float(filtered_state["amount"].sum()) / 10000000, 2)
    state_only = filtered_state[~filtered_state["state"].str.casefold().isin(UNION_TERRITORIES)]
    states_covered = int(state_only["state"].nunique())
    regions_covered = int(filtered_state["state"].nunique())
    quarter_order = {"Q1": 1, "Q2": 2, "Q3": 3, "Q4": 4}
    quarterly = (
        filtered_state.groupby(["year", "quarter"])
        .agg(
            transactions=("transactions", "sum"),
            amount=("amount", "sum"),
        )
        .reset_index()
    )
    quarterly_states = (
        state_only.groupby(["year", "quarter"])["state"]
        .nunique()
        .rename("states")
        .reset_index()
    )
    quarterly = quarterly.merge(quarterly_states, on=["year", "quarter"], how="left")
    quarterly["quarter_number"] = quarterly["quarter"].map(quarter_order)
    quarterly = quarterly.sort_values(["year", "quarter_number"])

    return {
        "total_transactions": total_transactions,
        "total_amount_crore": total_amount_crore,
        "states_covered": states_covered,
        "regions_covered": regions_covered,
        "quarterly_transactions": [int(value) for value in quarterly["transactions"]],
        "quarterly_amount_crore": [
            round(float(value) / 10000000, 2) for value in quarterly["amount"]
        ],
        "quarterly_states_covered": [int(value) for value in quarterly["states"]],
    }
    
@app.get("/api/top-states")
def get_top_states(
    year: Optional[int] = Query(None),
    states: Optional[str] = Query(None),
    limit: int = Query(10),
    all_years: bool = Query(False),
):
    if all_years:
        year = None
    state_list = states.split(",") if states is not None and states else ([] if states is not None else None)
    filtered_state, _ = filter_data(year, state_list)

    if filtered_state.empty:
        return {"data": []}

    top = (
        filtered_state
        .groupby("state")["transactions"]
        .sum()
        .reset_index()
        .sort_values("transactions", ascending=False)
        .head(limit)
    )

    result = [
        {
            "state": row["state"],
            "transactions": int(row["transactions"])
        }
        for _, row in top.iterrows()
    ]

    return {"data": result}

@app.get("/api/trends")
def get_trends(
    year: Optional[int] = Query(None),
    states: Optional[str] = Query(None),
    all_years: bool = Query(False),
):
    if all_years:
        year = None
    state_list = states.split(",") if states is not None and states else ([] if states is not None else None)
    filtered_state, _ = filter_data(year, state_list)

    if filtered_state.empty:
        return {"data": []}

    # Create quarter order
    quarter_order = {"Q1": 1, "Q2": 2, "Q3": 3, "Q4": 4}
    filtered_state = filtered_state.copy()
    filtered_state["quarter_number"] = filtered_state["quarter"].map(quarter_order)

    trend = (
        filtered_state
        .groupby(["year", "quarter", "quarter_number"])["transactions"]
        .sum()
        .reset_index()
        .sort_values(["year", "quarter_number"])
    )

    result = [
        {
            "period": f"{int(row['year'])} - {row['quarter']}",
            "transactions": int(row["transactions"])
        }
        for _, row in trend.iterrows()
    ]

    return {"data": result}

@app.get("/api/categories")
def get_categories(
    year: Optional[int] = Query(None),
    states: Optional[str] = Query(None),
    all_years: bool = Query(False),
):
    if all_years:
        year = None
    state_list = states.split(",") if states is not None and states else ([] if states is not None else None)
    _, filtered_category = filter_data(year, state_list)

    if filtered_category.empty:
        return {"data": []}

    cat = (
        filtered_category
        .groupby("category")[["transactions", "amount"]]
        .sum()
        .reset_index()
        .sort_values("transactions", ascending=False)
    )

    result = [
        {
            "category": row["category"],
            "transactions": int(row["transactions"]),
            "amount": float(row["amount"]),
        }
        for _, row in cat.iterrows()
    ]

    return {"data": result}

@app.get("/api/insights")
def get_insights(
    year: Optional[int] = Query(None),
    states: Optional[str] = Query(None),
    all_years: bool = Query(False),
):
    if all_years:
        year = None
    frame = state_df.copy()
    if states is not None:
        frame = frame[frame["state"].isin(states.split(",") if states else [])]
    years = sorted(frame["year"].dropna().astype(int).unique())
    if frame.empty or not years:
        return {"scope": "all" if year is None else year, "findings": []}

    def totals(data):
        return data.groupby("state")["transactions"].sum().sort_values(ascending=False)

    def concentration(data):
        by_state = totals(data)
        return float(by_state.head(5).sum() / by_state.sum() * 100) if by_state.sum() else 0.0

    def compact_count(value):
        value = float(value)
        if value >= 1_000_000_000:
            return f"{value / 1_000_000_000:.2f}B"
        if value >= 1_000_000:
            return f"{value / 1_000_000:.1f}M"
        if value >= 1_000:
            return f"{value / 1_000:.1f}K"
        return f"{value:,.0f}"

    findings = []
    scope = "all" if year is None else str(year)
    selected_label = " among the selected states" if states is not None else ""
    if year is None:
        annual = frame.groupby("year").agg(transactions=("transactions", "sum"), amount=("amount", "sum"))
        last_year = years[-1]
        latest_ticket = round(float(annual.loc[last_year, "amount"] / annual.loc[last_year, "transactions"])) if annual.loc[last_year, "transactions"] else None
        ticket_2021 = annual.loc[2021, "amount"] / annual.loc[2021, "transactions"] if 2021 in annual.index else 0
        ticket_latest = annual.loc[last_year, "amount"] / annual.loc[last_year, "transactions"] if annual.loc[last_year, "transactions"] else 0
        decline = (1 - ticket_latest / ticket_2021) * 100 if ticket_2021 else 0

        yearly_leaders = frame.groupby(["year", "state"])["transactions"].sum().reset_index().sort_values(["year", "transactions"], ascending=[True, False]).groupby("year").first()["state"]
        overall_leader = totals(frame).index[0]
        leader_2021 = yearly_leaders.get(2021)
        latest_streak = last_year
        for candidate in years:
            if candidate <= last_year and all(yearly_leaders.get(y) == overall_leader for y in years if y >= candidate):
                latest_streak = candidate
                break
        findings = [
            {"label": "Growth", "text": f"Average ticket size fell {decline:.1f}% from 2021 to {last_year}{selected_label}.", "highlight": f"{decline:.1f}%", "delta": -decline},
            {"label": "Leadership", "text": f"{leader_2021} led in 2021; {overall_leader} leads overall and has held the annual lead since {latest_streak}{selected_label}.", "highlight": f"{leader_2021} led in 2021", "delta": None},
            {"label": "Concentration", "text": f"The top five states hold {concentration(frame):.1f}% of transaction volume{selected_label}.", "highlight": f"{concentration(frame):.1f}%", "delta": None},
        ]
    else:
        current = frame[frame["year"] == year]
        previous = frame[frame["year"] == year - 1]
        if year == 2018:
            count_states = current["state"].nunique()
            first_year_total = compact_count(current["transactions"].sum())
            findings.append({"label": "Growth", "text": f"First year of data: {first_year_total} transactions across {count_states} states{selected_label}.", "highlight": first_year_total, "delta": None})
        else:
            if year == 2026:
                current = current[current["quarter"].isin(["Q1", "Q2"])]
                previous = previous[previous["quarter"].isin(["Q1", "Q2"])]
                comparison = "the same period in 2025 (Q1–Q2)"
                suffix = " (partial year)"
            else:
                comparison = str(year - 1)
                suffix = ""
            current_total = current["transactions"].sum()
            previous_total = previous["transactions"].sum()
            growth = (current_total / previous_total - 1) * 100 if previous_total else 0
            findings.append({"label": "Growth", "text": f"Transactions grew {growth:+.1f}% vs {comparison}{suffix}{selected_label}.", "highlight": f"{growth:+.1f}%", "delta": growth})

        ranked = totals(current)
        if len(ranked) >= 2:
            leader, runner_up = ranked.index[:2]
            margin = int(ranked.iloc[0] - ranked.iloc[1])
            if margin / max(int(ranked.iloc[0]), 1) < 0.02:
                formatted_margin = compact_count(margin)
                leader_sentence = f"{leader} led {year} by {formatted_margin} over {runner_up}{selected_label} (near tie)."
                leader_highlight = formatted_margin
            else:
                formatted_total = compact_count(ranked.iloc[0])
                leader_sentence = f"{leader} led {year} with {formatted_total} transactions{selected_label}."
                leader_highlight = formatted_total
            findings.append({"label": "Leadership", "text": leader_sentence, "highlight": leader_highlight, "delta": None})

        share = concentration(current)
        if year != 2018 and not previous.empty:
            previous_share = concentration(previous if year != 2026 else previous)
            delta = share - previous_share
            text = f"Top five states held {share:.1f}% in {year} vs {previous_share:.1f}% in {year - 1}{' (Q1–Q2)' if year == 2026 else ''}{selected_label}."
            findings.append({"label": "Concentration", "text": text, "highlight": f"{share:.1f}%", "delta": delta})
        else:
            findings.append({"label": "Concentration", "text": f"Top five states hold {share:.1f}% of volume{selected_label}.", "highlight": f"{share:.1f}%", "delta": None})

    return {"scope": scope, "ticket_year": last_year if year is None else year, "latest_ticket": latest_ticket if year is None else None, "findings": findings}

@app.post("/api/chat")
async def chat(request: dict):
    question = request.get("question", "")
    selected_year = request.get("year")
    states = request.get("states")

    if not question:
        return {"answer": "Please ask a question."}

    # Use all available years when the question asks for an overall result;
    # an explicit year in the question takes precedence over the dashboard filter.
    all_years_requested = re.search(
        r"\b(?:all\s+years?|overall|across\s+(?:all\s+)?years?|"
        r"combined\s+across\s+(?:all\s+)?years?|years?\s+combined|"
        r"entire\s+(?:time\s+)?period|whole\s+(?:time\s+)?period)\b",
        question,
        re.IGNORECASE,
    )
    year_range = re.search(
        r"\b(20\d{2})\s*(?:to|through|until|[-–—])\s*(20\d{2})\b",
        question,
        re.IGNORECASE,
    )
    explicit_year = re.search(r"\b(?:19|20)\d{2}\b", question)
    available_years = set(state_df["year"].dropna().astype(int).unique())
    if explicit_year and not year_range and int(explicit_year.group()) not in available_years:
        return {"answer": f"The dataset has no records for {explicit_year.group()}. Available years are {', '.join(map(str, sorted(available_years)))}."}
    if year_range:
        range_start, range_end = sorted((int(year_range.group(1)), int(year_range.group(2))))
        year = None
        year_scope = f"{range_start}–{range_end}"
    elif all_years_requested:
        range_start = range_end = None
        year = None
        year_scope = f"All years combined ({', '.join(map(str, sorted(available_years)))})"
    elif explicit_year and int(explicit_year.group()) in available_years:
        range_start = range_end = None
        year = int(explicit_year.group())
        year_scope = str(year)
    else:
        range_start = range_end = None
        year = selected_year
        year_scope = str(year) if year is not None else f"All years combined ({', '.join(map(str, sorted(available_years)))})"

    # Prepare data context
    state_list = states if states is not None else None
    if year_range:
        filtered_state = state_df[state_df["year"].between(range_start, range_end)].copy()
        filtered_category = category_df[category_df["year"].between(range_start, range_end)].copy()
        if state_list is not None:
            filtered_state = filtered_state[filtered_state["state"].isin(state_list)]
            filtered_category = filtered_category[filtered_category["state"].isin(state_list)]
    else:
        filtered_state, filtered_category = filter_data(year, state_list)

    if filtered_state.empty:
        scope_description = f"the requested period {year_scope}" if year_range else f"{year_scope}"
        return {"answer": f"There are no transaction records for {scope_description} with the selected state filters. Try a different year or state selection."}

    requested_data_state = next(
        (name for name in sorted(state_df["state"].dropna().unique(), key=len, reverse=True)
         if re.search(rf"\b{re.escape(name)}\b", question, re.IGNORECASE)),
        None,
    )
    category_breakdown_request = bool(re.search(r"\b(?:category|categories|breakdown|split)\b", question, re.IGNORECASE))
    if category_breakdown_request and requested_data_state:
        category_rows = filtered_category[filtered_category["state"].str.casefold() == requested_data_state.casefold()]
        category_totals = category_rows.groupby("category")["transactions"].sum().sort_values(ascending=False)
        if not category_totals.empty:
            rows = [f"| {category} | {int(value):,} |" for category, value in category_totals.items()]
            requested_scope = f"in {year_scope}" if year_scope else "across the selected period"
            return {"answer": f"{requested_data_state} transactions by category {requested_scope}:\n\n| Category | Transactions |\n| :--- | ---: |\n" + "\n".join(rows)}

    lowest_state_request = bool(re.search(
        r"\b(?:lowest|least|fewest|smallest|bottom)\b.*\b(?:state|states|transaction|transactions|volume)\b|\b(?:state|states)\b.*\b(?:lowest|least|fewest|smallest|bottom)\b",
        question,
        re.IGNORECASE,
    ))
    highest_state_request = bool(re.search(
        r"\b(?:top|highest|most|largest|leading)\b.*\b(?:state|states|transaction|transactions|volume)\b|\b(?:state|states)\b.*\b(?:top|highest|most|largest|leading)\b",
        question,
        re.IGNORECASE,
    ))
    if lowest_state_request or highest_state_request:
        rank_by_average_value = bool(re.search(r"\b(?:average|avg|mean)\b.*\b(?:value|amount|ticket|transaction)\b|\b(?:value|amount|ticket)\b.*\b(?:average|avg|mean|per\s+transaction)\b", question, re.IGNORECASE))
        ranking_data = filtered_state
        if re.search(r"\bstates?\b", question, re.IGNORECASE) and not re.search(r"\bregions?\b", question, re.IGNORECASE):
            ranking_data = ranking_data[~ranking_data["state"].str.casefold().isin(UNION_TERRITORIES)]
        ranked_states = ranking_data.groupby("state").agg(
            transactions=("transactions", "sum"),
            amount=("amount", "sum"),
        )
        ranked_states["average_value"] = ranked_states["amount"] / ranked_states["transactions"].replace(0, pd.NA)
        ranked_states = ranked_states.sort_values(
            "average_value" if rank_by_average_value else "transactions",
            ascending=lowest_state_request,
        )
        if not ranked_states.empty:
            requested_limit = re.search(r"\btop\s+(\d+)\b", question, re.IGNORECASE)
            singular_winner_request = bool(re.search(r"\b(?:which|what)\s+state\b|\bstate\s+(?:has|with)\s+(?:the\s+)?(?:most|highest|largest|lowest|least)\b", question, re.IGNORECASE))
            limit = (
                min(int(requested_limit.group(1)), len(ranked_states)) if requested_limit
                else 1 if singular_winner_request
                else 5 if lowest_state_request
                else 10 if re.search(r"\b(?:all|top|states?)\b", question, re.IGNORECASE)
                else 1
            )
            def compact_chat_count(value):
                value = float(value)
                if value >= 1_000_000_000: return f"{value / 1_000_000_000:.2f}B"
                if value >= 1_000_000: return f"{value / 1_000_000:.1f}M"
                if value >= 1_000: return f"{value / 1_000:.1f}K"
                return f"{value:,.0f}"
            show_average_value = rank_by_average_value or bool(re.search(r"\b(?:average|avg|mean)\b.*\b(?:value|amount|ticket|transaction)\b|\b(?:value|amount|ticket)\b.*\b(?:average|avg|mean|per\s+transaction)\b", question, re.IGNORECASE))
            table_requested = bool(re.search(r"\btable\b|\btabular\b", question, re.IGNORECASE))
            answer_lines = []
            table_rows = []
            for index, (name, row) in enumerate(ranked_states.head(limit).iterrows()):
                transaction_total = compact_chat_count(row["transactions"])
                line = f"{index + 1}. {name}: {transaction_total} transactions"
                average_value = row["average_value"] if pd.notna(row["average_value"]) else 0
                if show_average_value:
                    line += f" · average transaction value ₹{average_value:,.0f}"
                answer_lines.append(line)
                table_rows.append((name, transaction_total, f"₹{average_value:,.0f}"))
            scope_label = f"in {year}" if year is not None else "across all available years"
            region_label = "regions" if re.search(r"\bregions?\b", question, re.IGNORECASE) else "states"
            direction = "Lowest" if lowest_state_request else "Top"
            metric_label = "average transaction value" if rank_by_average_value else "transaction volume"
            if table_requested:
                headers = "| Rank | Region | Average transaction value | Transactions |" if rank_by_average_value else "| Rank | Region | Transactions | Average transaction value |" if show_average_value else "| Rank | Region | Transactions |"
                separator = "| ---: | :--- | ---: | ---: |" if show_average_value else "| ---: | :--- | ---: |"
                rows = [f"| {index} | {region} | {average} | {transactions} |" if rank_by_average_value else f"| {index} | {region} | {transactions} | {average} |" if show_average_value else f"| {index} | {region} | {transactions} |" for index, (region, transactions, average) in enumerate(table_rows, start=1)]
                return {"answer": f"{direction} {metric_label} {scope_label}, ranked among {region_label}:\n\n{headers}\n{separator}\n" + "\n".join(rows)}
            return {"answer": f"{direction} {metric_label} {scope_label}, ranked among {region_label}:\n" + "\n".join(answer_lines)}

    # A state-by-year chart is deterministic from the data, so return the chart
    # payload directly instead of asking the language model to describe it.
    chart_requested = bool(re.search(
        r"\b(?:bar\s*chart|pie\s*chart|donut\s*chart|line\s*chart|area\s*chart|chart|plot|graph|visuali[sz]ation|visuali[sz]e)\b",
        question,
        re.IGNORECASE,
    ))
    requested_chart_type = "pie" if re.search(r"\b(?:pie|donut)\s*chart\b", question, re.IGNORECASE) else "line" if re.search(r"\bline\s*chart\b", question, re.IGNORECASE) else "area" if re.search(r"\barea\s*chart\b", question, re.IGNORECASE) else "bar"
    year_axis_requested = bool(re.search(r"\b(?:x\s*axis|x-axis|horizontal\s+axis|year|yearly|annually|by\s+year|year\s+by\s+year|each\s+year|per\s+year)\b", question, re.IGNORECASE))
    requested_state = next(
        (name for name in sorted(state_df["state"].dropna().unique(), key=len, reverse=True)
         if re.search(rf"\b{re.escape(name)}\b", question, re.IGNORECASE)),
        None,
    )
    if requested_state is None and state_list is not None and len(state_list) == 1:
        requested_state = state_list[0]

    chart_all_years = year_range or all_years_requested or year_axis_requested or (explicit_year is None and selected_year is None)
    if chart_requested and requested_state:
        chart_state_data = state_df[state_df["state"].str.casefold() == requested_state.casefold()].copy()
        if year_range:
            chart_state_data = chart_state_data[chart_state_data["year"].between(range_start, range_end)]
        elif explicit_year and not chart_all_years:
            chart_state_data = chart_state_data[chart_state_data["year"] == int(explicit_year.group())]
        elif explicit_year and not chart_all_years:
            chart_state_data = chart_state_data[chart_state_data["year"] == int(explicit_year.group())]
        elif not chart_all_years and selected_year is not None:
            chart_state_data = chart_state_data[chart_state_data["year"] == int(selected_year)]
        chart_rows = (
            chart_state_data
            .groupby("year", as_index=False)["transactions"]
            .sum()
            .sort_values("year")
        )
        if not chart_rows.empty:
            available_in_range = set(chart_rows["year"].dropna().astype(int))
            missing_years = [year_value for year_value in range(range_start, range_end + 1) if year_value not in available_in_range] if year_range else []
            chart_start = range_start if year_range else int(chart_rows["year"].min())
            chart_end = range_end if year_range else int(chart_rows["year"].max())
            answer = f"Here are {requested_state}'s transaction totals by year for {chart_start}–{chart_end}, based on the available data."
            notes = []
            if missing_years:
                notes.append(f"No records were found for {', '.join(map(str, missing_years))}; those years are omitted.")
            quarters_by_year = (
                chart_state_data
                .groupby("year")["quarter"]
                .apply(lambda quarters: sorted(set(quarters.dropna().astype(str))))
            )
            partial_years = [
                f"{int(year_value)} includes {', '.join(quarters_by_year.loc[year_value])} only"
                for year_value in chart_rows["year"]
                if year_value in quarters_by_year.index and len(quarters_by_year.loc[year_value]) < 4
            ]
            if partial_years:
                notes.append("Partial-year totals: " + "; ".join(partial_years) + ".")
            return {
                "answer": answer,
                "chart": {
                    "type": requested_chart_type,
                    "title": f"{requested_state} transactions by year",
                    "data": [
                        {"year": int(row.year), "transactions": int(row.transactions)}
                        for row in chart_rows.itertuples(index=False)
                    ],
                    "note": " ".join(notes) or None,
                },
            }

    if filtered_state.empty:
        dataset_context = "No data available for the selected filters."
    else:
        state_summary = (
            filtered_state
            .groupby("state")["transactions"]
            .sum()
            .sort_values(ascending=False)
            .reset_index()
        )

        quarterly_summary = (
            filtered_state
            .groupby(["year", "quarter"])["transactions"]
            .sum()
            .reset_index()
        )

        state_year_summary = (
            filtered_state.groupby(["state", "year"])
            .agg(transactions=("transactions", "sum"), amount=("amount", "sum"))
            .reset_index()
        )

        if not filtered_category.empty:
            state_category_summary = (
                filtered_category.groupby(["state", "category"])["transactions"]
                .sum().reset_index().sort_values(["state", "transactions"], ascending=[True, False])
            )
            state_category_text = state_category_summary.to_string(index=False)
            category_year_summary = (
                filtered_category.groupby(["year", "category"])["transactions"]
                .sum().reset_index().sort_values(["year", "category"])
            )
            category_year_text = category_year_summary.to_string(index=False)
        else:
            state_category_text = category_year_text = "No category records available for this scope."

        if not filtered_category.empty:
            category_summary = (
                filtered_category
                .groupby("category")["transactions"]
                .sum()
                .sort_values(ascending=False)
                .reset_index()
            )
            category_text = category_summary.to_string(index=False)
        else:
            category_text = "No category data available."

        dataset_context = f"""
YEAR SCOPE: {year_scope}
AVAILABLE DATA YEARS: {', '.join(map(str, sorted(available_years)))}
TOTAL TRANSACTIONS: {int(filtered_state['transactions'].sum()):,}

TOP STATES:
{state_summary.to_string(index=False)}

STATE AND YEAR TRANSACTIONS AND VALUE:
{state_year_summary.to_string(index=False)}

QUARTERLY DATA:
{quarterly_summary.to_string(index=False)}

CATEGORIES:
{category_text}

TRANSACTIONS BY STATE AND CATEGORY:
{state_category_text}

TRANSACTIONS BY YEAR AND CATEGORY:
{category_year_text}
"""

    prompt = f"""
You are a helpful UPI Payments Analytics Assistant.
Answer using only the data provided below.
Explain in simple language. Use bullet points when useful.
Start with the direct answer; avoid introductory phrases such as “Based on the data provided”.
The category dataset contains transactions by state, year, quarter, and category. Use TRANSACTIONS BY STATE AND CATEGORY to answer state-specific category questions; never claim that breakdown is missing when rows are present.
The state transaction dataset contains transaction counts and rupee amounts. The category dataset contains transaction counts, but its amount values are all zero and must be treated as unavailable; never report ₹0 or claim category-level monetary values are present.
Only report years and states present in the supplied data. If a comparison includes a partial year, compare matching quarters and label the partial period clearly.
For rankings, use the requested metric (transaction count, amount, average ticket/value per transaction, or category share) and state the metric and time scope in the answer.
Use a concise Markdown table for multi-item comparisons when it improves readability.
Do not invent numbers.
Treat YEAR SCOPE as authoritative, including when it says all years are combined.

DATA:
{dataset_context}

QUESTION: {question}

Answer:
"""

    try:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            return {"answer": "Gemini API key not found. Please check your .env file."}

        client = genai.Client(api_key=api_key)

        def stream_answer():
            try:
                for response in client.models.generate_content_stream(
                    model="gemini-3.5-flash-lite",
                    contents=prompt,
                ):
                    if response.text:
                        yield response.text
            except Exception as stream_error:
                yield f"\n\nError: {str(stream_error)}"

        return StreamingResponse(
            stream_answer(),
            media_type="text/plain; charset=utf-8",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    except Exception as e:
        return {"answer": f"Error: {str(e)}"}
