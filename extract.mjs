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
const guns=await (await new ethers.ContractFactory(Guns.abi,Guns.bytecode,owner).deploy(ethers.parseEther("1"),await art.getAddress(),seedCommit)).waitForDeployment();
await (await guns.setMintOpen(true)).wait();
await (await guns.mintOneOfOne(accts[1],1)).wait();  // Gold Standard 1/1
await (await guns.mintOneOfOne(accts[1],5)).wait();  // Baba Yaga 1/1
await (await guns.connect(await provider.getSigner(accts[1])).mint(2,{value:ethers.parseEther("2"),gasLimit:400000})).wait();
await (await guns.closeMint()).wait();
await provider.send("evm_mine",[]); await provider.send("evm_mine",[]);
await (await guns.reveal(ownerSeed)).wait();  // reveal so public tokens show their guns
let html="<body style='background:#0a0c12;display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px;max-width:840px'>";
for(const id of [1,5,6,7]){
  const uri=await guns.tokenURI(id);
  const meta=JSON.parse(Buffer.from(uri.split(",")[1],"base64").toString());
  html+=`<img style='width:100%' src='${meta.image}' title='${meta.name}'>`;
  console.log(id, meta.name, "type", Number(await guns.gunTypeOf(id)), "svg bytes", Buffer.from(meta.image.split(",")[1],"base64").length);
}
writeFileSync("../wick-arsenal/web/chain-preview.html", html+"</body>");
console.log("wrote web/chain-preview.html");
process.exit(0);
