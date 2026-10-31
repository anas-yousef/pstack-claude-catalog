const BARE_KEY = /^[A-Za-z0-9_-]+$/

export function codexTables(pin, marketplace) {
  const marketKey = BARE_KEY.test(marketplace) ? `marketplaces.${marketplace}` : `marketplaces."${marketplace}"`
  const source = pin.repo.endsWith('.git') ? pin.repo : `${pin.repo}.git`
  const tables = {
    [marketKey]: {
      source_type: 'git',
      source,
      ref: pin.commit,
    },
  }
  for (const plugin of pin.plugins) {
    tables[`plugins."${plugin}@${marketplace}"`] = { enabled: true }
  }
  return tables
}
