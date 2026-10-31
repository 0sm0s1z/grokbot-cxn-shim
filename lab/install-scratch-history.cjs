'use strict';
// Offline lab-only update; stop the copied app first.
const fs=require('fs'),path=require('path');
const {readEntry,rebuildArchive,parseArchive,digest,verifyArchiveIntegrity}=require('../installer/dist/asar.cjs');
const {decodePlist,encodePlist}=require('../installer/dist/plist.cjs');
const base=path.resolve(process.argv[2]??'');
if(!base.startsWith(path.resolve('lab')+path.sep)||!base.endsWith('.app'))throw Error('only a lab app copy is supported');
const backup=base+'.grokbot-shim-backup',ap=path.join(base,'Contents/Resources/app.asar'),ip=path.join(base,'Contents/Info.plist'),sp=path.join(backup,'state.json');
const archive=fs.readFileSync(ap),plist=fs.readFileSync(ip),oldState=fs.readFileSync(sp),state=JSON.parse(oldState);
if(digest(archive)!==state.archiveSha256||digest(plist)!==state.plistSha256)throw Error('unexpected lab state');
if(fs.existsSync(path.join(backup,'before-scratch-history.asar')))throw Error('history backup exists');
const target='dist/node-agent-coordinator/main.cjs';
if(digest(readEntry(archive,target))!=='13185d41447fd20ca3d70c954d5710faccf75774f3b00f373e293ed6aabc2211')throw Error('unsupported scratch coordinator');
const proposal=fs.readFileSync('lab/coordinator-scratch-proposal.cjs');
const changes=new Map([[target,proposal],['dist/node-agent-coordinator/grokbot-scratch/native-scratch.cjs',fs.readFileSync('native-scratch.cjs')],['dist/node-agent-coordinator/grokbot-scratch/router.cjs',fs.readFileSync('router.cjs')]]);
const adds=new Map([['dist/node-agent-coordinator/grokbot-scratch/scratch-store.cjs',fs.readFileSync('scratch-store.cjs')]]);
const next=rebuildArchive(archive,changes,adds);verifyArchiveIntegrity(next);const meta=decodePlist(plist);meta.ElectronAsarIntegrity['Resources/app.asar'].hash=digest(parseArchive(next).headerBytes);const nextPlist=encodePlist(meta,plist);
fs.writeFileSync(path.join(backup,'before-scratch-history.asar'),archive,{flag:'wx'});fs.writeFileSync(path.join(backup,'before-scratch-history.Info.plist'),plist,{flag:'wx'});fs.writeFileSync(path.join(backup,'before-scratch-history.state.json'),oldState,{flag:'wx'});
try{fs.writeFileSync(ap+'.next',next,{flag:'wx'});fs.writeFileSync(ip+'.next',nextPlist,{flag:'wx'});fs.renameSync(ap+'.next',ap);fs.renameSync(ip+'.next',ip);state.archiveSha256=digest(next);state.plistSha256=digest(nextPlist);state.scratchCoordinatorSha256=digest(proposal);fs.writeFileSync(sp+'.next',JSON.stringify(state,null,2)+'\n',{flag:'wx'});fs.renameSync(sp+'.next',sp)}catch(e){fs.writeFileSync(ap,archive);fs.writeFileSync(ip,plist);fs.writeFileSync(sp,oldState);for(const f of [ap+'.next',ip+'.next',sp+'.next'])fs.rmSync(f,{force:true});throw e}
console.log(JSON.stringify({app:base,archiveSha256:state.archiveSha256,plistSha256:state.plistSha256,requiresResigning:true}));
