const BARE_KEY = /^[A-Za-z0-9_-]+$/
const SLUG = /^[a-z0-9][a-z0-9-]*$/

export function marketplaceFrom(text) {
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('marketplace.json is not JSON')
  }
  if (!json || typeof json.name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(json.name)) throw new Error('marketplace.json needs a plain name')
  if (!Array.isArray(json.plugins) || json.plugins.length === 0) throw new Error('marketplace.json needs plugins')
  const plugins = json.plugins.map((plugin) => {
    if (!plugin || typeof plugin.name !== 'string' || !SLUG.test(plugin.name)) throw new Error('marketplace plugin name is not a plain slug')
    return plugin.name
  })
  return { name: json.name, plugins }
}

export function codexTables(pin, marketplace) {
  const marketKey = BARE_KEY.test(marketplace) ? `marketplaces.${marketplace}` : `marketplaces."${marketplace}"`
  const source = pin.repo.endsWith('.git') ? pin.repo : `${pin.repo}.git`
  const tables = {
    [marketKey]: { source_type: 'git', source, ref: pin.commit },
  }
  for (const plugin of pin.plugins) tables[`plugins."${plugin}@${marketplace}"`] = { enabled: true }
  return tables
}
