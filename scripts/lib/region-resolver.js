'use strict';

const { stableStringify } = require('./normalize');
const { getParentChain, matchRegion } = require('./region-index');

class RegionResolver {
  constructor(index) {
    this.index = index;
    this.queryCache = new Map();
    this.stats = { queries: 0, cache_hits: 0, resolved: 0, review_required: 0 };
  }

  resolveRecord(record) {
    const key = stableStringify(record.geography || {}, 0);
    this.stats.queries += 1;
    if (this.queryCache.has(key)) {
      this.stats.cache_hits += 1;
      return clone(this.queryCache.get(key));
    }
    const result = resolveGeography(record.geography || {}, this.index);
    if (result.status === 'MATCHED') this.stats.resolved += 1;
    else this.stats.review_required += 1;
    this.queryCache.set(key, clone(result));
    return result;
  }
}

function resolveGeography(geography, index) {
  const ordered = [
    ['country', geography.country],
    ['province', geography.province],
    ['city', geography.city],
    ['area', geography.area],
  ];
  const matches = {};
  const issues = [];
  let parent = null;

  for (const [label, part] of ordered) {
    if (!part || (!part.id && !part.name && !part.area_code)) {
      matches[label] = null;
      continue;
    }
    const query = part.id
      ? { id: part.id, parentId: parent?.id }
      : {
          name: part.name,
          areaCode: part.area_code,
          level: part.level,
          parentId: parent?.id,
        };
    const match = matchRegion(query, index, { allowAncestorParent: true });
    if (match.status !== 'RESOLVED') {
      issues.push({
        code: `REGION_${match.status}`,
        field: label,
        query: compactQuery(query),
        reasons: match.reasons,
        candidates: (match.candidates || []).slice(0, 10).map(publicRegion),
      });
      matches[label] = null;
      continue;
    }
    matches[label] = publicRegion(match.record);
    parent = match.record;
  }

  if (!matches.country) {
    issues.push({ code: 'COUNTRY_NOT_RESOLVED', field: 'country' });
  }
  const resolved = Object.values(matches).filter(Boolean);
  for (let indexPosition = 1; indexPosition < resolved.length; indexPosition += 1) {
    const ancestor = resolved[indexPosition - 1];
    const child = resolved[indexPosition];
    const chain = getParentChain(child.id, index);
    if (chain.status !== 'VALID' || !chain.ids.includes(ancestor.id)) {
      issues.push({
        code: 'REGION_PARENT_CHAIN_MISMATCH',
        ancestor_id: ancestor.id,
        child_id: child.id,
        chain_status: chain.status,
      });
    }
  }

  return {
    status: issues.length ? 'REVIEW_REQUIRED' : 'MATCHED',
    country_id: matches.country?.id || null,
    province_id: matches.province?.id || null,
    city_id: matches.city?.id || null,
    area_id: matches.area?.id || null,
    matches,
    issues,
  };
}

function publicRegion(record) {
  return {
    id: record.id,
    name: record.name,
    names: record.names,
    level: record.level,
    parent_id: record.parentId || null,
    area_code: record.areaCode || null,
    internal_primary_key: record.internalPrimaryKey,
  };
}

function compactQuery(query) {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== null && value !== undefined && value !== ''));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  RegionResolver,
  resolveGeography,
};
