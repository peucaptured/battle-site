from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
import json


ROOT = Path(__file__).resolve().parent
ART_DIR = ROOT / "poke" / "home"
SHINY_ART_DIR = ROOT / "poke" / "home-shiny"
GIF_DIR = ROOT / "sprites"
OUTPUT_PATH = ROOT / "assets" / "pokemon_form_manifest.json"
SLUG_MAP_PATH = ROOT / "assets" / "pokedex_map_slug_to_id.json"
EXISTING_MANIFEST_PATH = OUTPUT_PATH


FORM_ROOT_DEFAULT_SLUGS = {
    "aegislash": "aegislash-blade",
    "arceus": "arceus-normal",
    "basculin": "basculin-red-striped",
    "basculegion": "basculegion-male",
    "darmanitan": "darmanitan-standard",
    "deoxys": "deoxys-normal",
    "eiscue": "eiscue-ice",
    "enamorus": "enamorus-incarnate",
    "giratina": "giratina-altered",
    "gourgeist": "gourgeist-average",
    "indeedee": "indeedee-male",
    "keldeo": "keldeo-ordinary",
    "landorus": "landorus-incarnate",
    "lycanroc": "lycanroc-midday",
    "maushold": "maushold-family-of-four",
    "meloetta": "meloetta-aria",
    "meowstic": "meowstic-male",
    "mimikyu": "mimikyu-disguised",
    "minior": "minior-red-meteor",
    "morpeko": "morpeko-full-belly",
    "oricorio": "oricorio-baile",
    "palafin": "palafin-zero",
    "pumpkaboo": "pumpkaboo-average",
    "sawsbuck": "sawsbuck-spring",
    "shaymin": "shaymin-land",
    "silvally": "silvally-normal",
    "squawkabilly": "squawkabilly-green-plumage",
    "tatsugiri": "tatsugiri-curly",
    "thundurus": "thundurus-incarnate",
    "tornadus": "tornadus-incarnate",
    "toxtricity": "toxtricity-amped",
    "urshifu": "urshifu-single-strike",
    "wishiwashi": "wishiwashi-solo",
    "wormadam": "wormadam-plant",
    "zygarde": "zygarde-50",
}

EXPLICIT_SOURCE_ALIASES = {
    "basculegion-f": "basculegion-female",
    "darmanitan-galar": "darmanitan-galar-standard",
    "indeedee-f": "indeedee-female",
    "maushold-four": "maushold-family-of-four",
    "meowstic-f": "meowstic-female",
    "pyroar-f": "pyroar-female",
}

TOKEN_REPLACEMENTS = {
    "caramelswirl": "caramel-swirl",
    "lemoncream": "lemon-cream",
    "matchacream": "matcha-cream",
    "mintcream": "mint-cream",
    "rainbowswirl": "rainbow-swirl",
    "rubycream": "ruby-cream",
    "rubyswirl": "ruby-swirl",
    "saltedcream": "salted-cream",
    "vanillacream": "vanilla-cream",
}


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def compact_slug(value: str) -> str:
    return "".join(ch for ch in value.lower() if ch.isalnum())


def build_canonical_slug_index() -> dict[str, list[str]]:
    canonical_slugs: set[str] = set()

    if SLUG_MAP_PATH.exists():
        canonical_slugs.update(read_json(SLUG_MAP_PATH).keys())

    if EXISTING_MANIFEST_PATH.exists():
        existing = read_json(EXISTING_MANIFEST_PATH)
        canonical_slugs.update(existing.get("available_slugs", []))
        canonical_slugs.update(existing.get("art_map", {}).keys())
        canonical_slugs.update(existing.get("shiny_art_map", {}).keys())
        canonical_slugs.update(existing.get("gif_map", {}).keys())

    canonical_slugs.update(FORM_ROOT_DEFAULT_SLUGS.values())
    canonical_slugs.update(EXPLICIT_SOURCE_ALIASES.values())

    compact_index: dict[str, list[str]] = defaultdict(list)
    for slug in sorted(filter(None, canonical_slugs)):
        compact_index[compact_slug(slug)].append(slug)
    return compact_index


def normalize_source_name(source_name: str) -> str:
    slug = source_name.strip().lower()
    for src, dst in TOKEN_REPLACEMENTS.items():
        slug = slug.replace(src, dst)
    return slug


def choose_canonical_slug(source_basename: str, compact_index: dict[str, list[str]]) -> str:
    normalized = normalize_source_name(source_basename)

    if normalized in EXPLICIT_SOURCE_ALIASES:
        return EXPLICIT_SOURCE_ALIASES[normalized]

    if normalized in compact_index.get(compact_slug(normalized), []):
        return normalized

    if normalized in FORM_ROOT_DEFAULT_SLUGS:
        return FORM_ROOT_DEFAULT_SLUGS[normalized]

    matches = compact_index.get(compact_slug(normalized), [])
    if matches:
        ordered = sorted(matches, key=lambda slug: (slug != normalized, len(slug), slug))
        return ordered[0]

    return normalized


def choose_source_basename(canonical_slug: str, options: list[str]) -> str:
    unique = sorted(set(options))
    if canonical_slug in unique:
        return canonical_slug
    return unique[0]


def build_source_map(source_dir: Path, suffix: str, compact_index: dict[str, list[str]]) -> dict[str, str]:
    grouped: dict[str, list[str]] = defaultdict(list)
    if not source_dir.exists():
        return {}

    for path in sorted(source_dir.iterdir(), key=lambda item: item.name.lower()):
        if not path.is_file() or path.suffix.lower() != suffix:
            continue
        canonical_slug = choose_canonical_slug(path.stem, compact_index)
        grouped[canonical_slug].append(path.stem)

    return {
        slug: choose_source_basename(slug, basenames)
        for slug, basenames in sorted(grouped.items())
    }


def build_manifest() -> dict[str, object]:
    compact_index = build_canonical_slug_index()
    art_map = build_source_map(ART_DIR, ".png", compact_index)
    shiny_art_map = build_source_map(SHINY_ART_DIR, ".png", compact_index)
    gif_map = build_source_map(GIF_DIR, ".gif", compact_index)
    available_slugs = sorted(set(art_map) | set(shiny_art_map) | set(gif_map))
    return {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "available_slugs": available_slugs,
        "art_map": art_map,
        "shiny_art_map": shiny_art_map,
        "gif_map": gif_map,
    }


def main() -> None:
    manifest = build_manifest()
    OUTPUT_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT_PATH} with {len(manifest['available_slugs'])} slugs.")


if __name__ == "__main__":
    main()
