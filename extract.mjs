// pull real tokenURI SVGs off an in-process chain and save them for visual check
import { readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
const reqHere=createRequire(import.meta.url), reqCash=createRequire("C:/Users/Bia/New folder/cashcat-printer/");
const ganache=reqHere("ganache"), ethers=reqCash("ethers");
const load=n=>JSON.parse(readFileSync("./out/"+n+".json","utf8"));
const Guns=load("WickGuns"), Art=load("WickGunArt"), Bodies=load("WickGunBodies");
const provider=new ethers.BrowserProvider(ganache.provider({logging:{quiet:true},wallet:{totalAccounts:3,defaultBalance:100000}}));
const accts=await provider.send("eth_accounts",[]); const owner=await provider.getSigner(accts[0]);
const ownerSeed=ethers.hexlify(ethers.randomBytes(32)), seedCommit=ethers.keccak256(ownerSeed);
const bodies=await (await new ethers.ContractFactory(Bodies.abi,Bodies.bytecode,owner).deploy()).waitForDeployment();
const art=await (await new ethers.ContractFactory(Art.abi,Art.bytecode,owner).deploy(await bodies.getAddress())).waitForDeployment();
// burn route left unset (address(0)) — this is a local render harness, not a mint sim
const guns=await (await new ethers.ContractFactory(Guns.abi,Guns.bytecode,owner).deploy(ethers.parseEther("1"),await art.getAddress(),seedCommit,ethers.ZeroAddress,ethers.ZeroAddress,ethers.ZeroAddress)).waitForDeployment();
await (await guns.setMintOpen(true)).wait();
await (await guns.mintTangent(accts[1])).wait();     // #1 TANGENTIAL REAPER — the only reserved token
// sweep the whole 100-case pool: the tier counts are fixed (30/25/18/15/7 + the five
// platinum holos), so a full mint guarantees every card design exists to render
const buyer=await provider.getSigner(accts[1]);
for(let i=0;i<20;i++) await (await guns.connect(buyer).mint(5,{value:ethers.parseEther("5"),gasLimit:1100000})).wait();
await (await guns.closeMint()).wait();
await provider.send("evm_mine",[]); await provider.send("evm_mine",[]);
await (await guns.reveal(ownerSeed)).wait();  // reveal so public tokens show their guns
// one representative id per gun type — tiers 1..5 then the platinum holos 11..15,
// with the Reaper (#1, type 16) leading the sheet
const rep={};
for(let id=2;id<=101;id++){ const t=Number(await guns.gunTypeOf(id)); if(rep[t]===undefined) rep[t]=id; }
const sheet=[1,...Object.keys(rep).map(Number).sort((a,b)=>a-b).map(t=>rep[t])];
let html="<body style='background:#0a0c12;display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;padding:10px;max-width:1260px'>";
for(const id of sheet){
  const uri=await guns.tokenURI(id);
  const meta=JSON.parse(Buffer.from(uri.split(",")[1],"base64").toString());
  html+=`<img style='width:100%' src='${meta.image}' title='${meta.name}'>`;
  console.log(id, meta.name, "type", Number(await guns.gunTypeOf(id)), "svg bytes", Buffer.from(meta.image.split(",")[1],"base64").length);
}
writeFileSync("../wick-arsenal/web/chain-preview.html", html+"</body>");
console.log("wrote web/chain-preview.html");
process.exit(0);
