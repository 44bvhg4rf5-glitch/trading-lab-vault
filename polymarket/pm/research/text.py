"""Free text helpers: tokenising, similarity, keyword extraction. No models needed."""
from __future__ import annotations

import re

STOP = set("""a an the of to in on at by for with and or will be is are was were been being do does did
has have had this that these those it its as from into than then there their they them he she his her
if not no yes before after over under about above below between during until while who whom which what
when where why how any all more most some such only own same so too very can could should would may might
must shall up down out off again further once here both each few other another""".split())

_WORD = re.compile(r"[a-z0-9][a-z0-9'\-\.]*")

# collapse common phrasings so cross-venue questions line up
SYNONYMS = {"raise": "increase", "raises": "increase", "hike": "increase", "hikes": "increase",
            "cut": "decrease", "cuts": "decrease", "lower": "decrease", "lowers": "decrease",
            "reduce": "decrease", "win": "win", "wins": "win", "become": "be", "becomes": "be",
            "reach": "hit", "reaches": "hit", "hits": "hit", "exceed": "above", "exceeds": "above",
            "rate": "rates", "meeting": "", "bps": "", "bp": ""}


def tokens(text: str, normalize: bool = True) -> list[str]:
    out = []
    for raw in _WORD.findall(text.lower()):
        t = raw.strip("'.-")
        if normalize:
            t = SYNONYMS.get(t, t)
        if t and t not in STOP:
            out.append(t)
    return out


def keywords(text: str, n: int = 6) -> list[str]:
    """Search terms for external APIs: original words, no synonym folding."""
    seen: list[str] = []
    for t in tokens(text, normalize=False):
        if len(t) >= 3 and t not in seen:
            seen.append(t)
    return seen[:n]


def jaccard(a: str, b: str) -> float:
    sa, sb = set(tokens(a)), set(tokens(b))
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


DEADLINE_HINT = re.compile(r"\b(by|before|on or before|until|through|prior to)\b", re.I)


def implies_deadline(question: str) -> bool:
    """'Will X happen by <date>?' style markets: YES needs an event to occur before resolution."""
    return bool(DEADLINE_HINT.search(question)) and question.lower().startswith("will")


MONTHS = {"january", "february", "march", "april", "may", "june", "july", "august", "september",
          "october", "november", "december"}


def entity_terms(question: str, n: int = 5) -> str:
    """Names, numbers and months from the original question — the tokens most likely to
    survive a rephrasing on another venue ("raise" vs "increase" doesn't matter, "Fed" does)."""
    words = re.findall(r"[A-Za-z0-9$][A-Za-z0-9$,\.\-']*", question)
    out: list[str] = []
    for i, w in enumerate(words):
        clean = w.strip(",.'")
        low = clean.lower()
        if not clean or low in STOP or (i == 0 and low == "will"):
            continue
        if clean[0].isupper() or clean[0].isdigit() or clean[0] == "$" or low in MONTHS:
            if low not in (x.lower() for x in out):
                out.append(clean)
    return " ".join(out[:n])


NEGATIONS = {"no", "not", "never", "without", "fail", "fails", "neither", "nor", "unchanged"}
ANTONYMS = [("increase", "decrease"), ("above", "below"), ("win", "lose"), ("yes", "no"),
            ("before", "after"), ("more", "less"), ("higher", "lower"), ("over", "under")]
_NUM = re.compile(r"\d+(?:\.\d+)?")


def compatible(a: str, b: str) -> tuple[bool, str]:
    """Guard against matching a question to its opposite on another venue.

    Rejects when: one side is negated and the other is not; both mention numbers but share
    none; or the two sides use opposite direction words."""
    ra = set(re.findall(r"[a-z]+", a.lower()))
    rb = set(re.findall(r"[a-z]+", b.lower()))
    if bool(ra & NEGATIONS) != bool(rb & NEGATIONS):
        return False, "negation-mismatch"
    strip = lambda t: re.sub(r"(?<=\d),(?=\d)", "", t)   # 80,000 -> 80000
    na, nb = set(_NUM.findall(strip(a))), set(_NUM.findall(strip(b)))
    if na and nb and not (na & nb):
        return False, "number-mismatch"
    ta, tb = set(tokens(a)), set(tokens(b))
    for x, y in ANTONYMS:
        if (x in ta and y in tb and x not in tb) or (y in ta and x in tb and y not in tb):
            return False, f"antonym-{x}/{y}"
    return True, "ok"
