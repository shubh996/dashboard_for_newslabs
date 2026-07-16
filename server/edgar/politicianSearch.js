// Local name search over congressional/executive filers -- backs the search
// bar's ability to find a politician who hasn't been saved to Supabase yet
// (there's no live SEC endpoint for "look up a STOCK Act filer by name").
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILERS_INDEX_PATH = path.join(__dirname, '..', 'data', 'congress', 'filers.json')

let filersPromise = null

async function loadFilers() {
  const text = await readFile(FILERS_INDEX_PATH, 'utf-8')
  return JSON.parse(text)
}

function getFilers() {
  if (!filersPromise) filersPromise = loadFilers()
  return filersPromise
}

export async function searchFilersByName(query, limit = 10) {
  const filers = await getFilers()
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  return filers
    .filter((filer) => (filer.full_name || '').toLowerCase().includes(needle))
    .slice(0, limit)
    .map((filer) => ({ filerId: filer.id, fullName: filer.full_name }))
}

export async function getRecentFilers(limit = 10) {
  const filers = await getFilers()
  return filers.slice(0, limit).map((filer) => ({ filerId: filer.id, fullName: filer.full_name }))
}
