import fs from 'node:fs';
import path from 'node:path';
export type Source={id:number|null;title:string|null;url:string;referer:string|null;origin:string|null;country:string|null;vip:boolean};
export type Channel={id:number;catId:number;name:string;nameEn:string;image:string|null;url:string;referer:string|null;origin:string|null;vpn:boolean;iran:boolean;popular:number;vip:boolean;category:string;categoryEn:string;sources:Source[]};
export function getStaticChannels():Channel[]{const dir=path.join(process.cwd(),'data');const files=fs.readdirSync(dir).filter(f=>/^channels-\d+\.json$/.test(f)).sort();return files.flatMap(f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')) as Channel[]);}
export function getCategories(){return Array.from(new Map(getStaticChannels().map(c=>[c.catId,{id:c.catId,name:c.category,nameEn:c.categoryEn}])).values()).filter(c=>c.id!==0)}
export function findStaticChannel(id:number){return getStaticChannels().find(c=>c.id===id)??null;}