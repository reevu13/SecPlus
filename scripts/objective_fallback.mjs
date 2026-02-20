const OBJECTIVE_ID_PATTERN = /^\d+\.\d+$/;

const CHAPTER_OBJECTIVE_FALLBACK = {
  1: ['2.1'],
  2: ['2.2'],
  3: ['2.3'],
  4: ['1.1', '1.2'],
  5: ['1.3', '1.4'],
  6: ['1.5', '1.6'],
  7: ['3.1'],
  8: ['3.2'],
  9: ['3.3'],
  10: ['3.4'],
  11: ['4.1', '4.2'],
  12: ['4.3', '4.4'],
  13: ['4.5', '4.6'],
  14: ['4.7', '4.8'],
  15: ['5.1', '5.2'],
  16: ['5.3', '5.4'],
  17: ['5.5', '5.6', '5.7']
};

export function parseUniqueObjectiveIds(values) {
  if (!Array.isArray(values)) return [];
  const set = new Set(
    values
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => OBJECTIVE_ID_PATTERN.test(value))
  );
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function objectiveIdsFromTags(values) {
  if (!Array.isArray(values)) return [];
  const ids = new Set();
  values.forEach((value) => {
    if (typeof value !== 'string') return;
    value.match(/\b\d+\.\d+\b/g)?.forEach((candidate) => {
      if (OBJECTIVE_ID_PATTERN.test(candidate)) ids.add(candidate);
    });
  });
  return [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

export function fallbackObjectiveIdsForPack(pack) {
  const chapterNumber = Number.isFinite(pack?.chapter?.number)
    ? Number(pack.chapter.number)
    : null;
  const chapterFallbackObjectiveIds = chapterNumber
    ? parseUniqueObjectiveIds(CHAPTER_OBJECTIVE_FALLBACK[chapterNumber] ?? [])
    : [];

  return parseUniqueObjectiveIds([
    ...parseUniqueObjectiveIds(pack?.objectiveIds),
    ...chapterFallbackObjectiveIds
  ]);
}

export function objectiveIdsForQuestion(question, pack) {
  const explicitQuestionObjectiveIds = parseUniqueObjectiveIds(question?.objectiveIds);
  const inferredFromTags = objectiveIdsFromTags(question?.tags);
  const fallbackFromPack = fallbackObjectiveIdsForPack(pack);
  return parseUniqueObjectiveIds([
    ...explicitQuestionObjectiveIds,
    ...inferredFromTags,
    ...fallbackFromPack
  ]);
}
