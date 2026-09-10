import {fetchCatalog,categoriesOf,Channel} from './source';
export type {Channel};
export async function getCatalog(){return fetchCatalog()}
export function getCategories(channels:Channel[]){return categoriesOf(channels)}
export async function findChannel(id:number){const channels=await fetchCatalog();return channels.find(c=>c.id===id)??null}