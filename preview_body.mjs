import sharp from 'sharp'

const AMBER='#E8A020', AMBER_DIM='rgba(232,160,32,0.42)', BODY='rgba(255,255,255,0.10)', SIL='rgba(255,255,255,0.045)', SEP='#0a0a0c'
function mirror(p){return p.trim().split(/\s+/).map(q=>{const[x,y]=q.split(',');return`${(100-parseFloat(x)).toFixed(1)},${y}`}).join(' ')}
function poly(pts,fill){return`<polygon points="${pts}" fill="${fill}" stroke="${SEP}" stroke-width="0.6"/>`}
// fill all muscles amber (primary) to inspect layout; a few dim to check secondary tone
function M(id,pts,mir=true,fill=AMBER){let s=poly(pts,fill);if(mir)s+=poly(mirror(pts),fill);return s}
const SILH=`<g fill="${SIL}">
<circle cx="50" cy="14" r="9"/>
<polygon points="45,21 55,21 56,29 44,29"/>
<polygon points="33,29 67,29 73,41 72,118 63,127 37,127 28,118 27,41"/>
<polygon points="27,39 17,45 17,104 26,107 28,53"/>
<polygon points="73,39 83,45 83,104 74,107 72,53"/>
<ellipse cx="20" cy="111" rx="5" ry="6.5"/>
<ellipse cx="80" cy="111" rx="5" ry="6.5"/>
<polygon points="33,120 50,120 50,237 31,237 29,150"/>
<polygon points="50,120 67,120 71,150 69,237 50,237"/>
<ellipse cx="38" cy="239" rx="9" ry="4.5"/>
<ellipse cx="62" cy="239" rx="9" ry="4.5"/>
</g>`
const front=SILH+
M('chest','50,33 37,35 33,49 43,55 50,55')+
M('front_delt','37,34 27,39 25,51 33,50 36,41')+
M('biceps','26,53 33,52 32,75 25,73')+
M('forearms','25,77 32,76 31,102 24,100')+
M('obliques','42,58 36,59 35,99 43,103',true,AMBER_DIM)+
M('upper_abs','43,57 57,57 56,79 44,79',false)+
M('lower_abs','44,81 56,81 55,104 45,104',false)+
M('quads','34,124 49,124 48,194 31,191 32,134')+
M('adductors','45,128 55,128 54,182 46,182',false,AMBER_DIM)+
M('calves','34,200 48,201 46,233 36,231')
const back=SILH+
M('traps','39,30 50,24 61,30 60,45 50,48 40,45',false)+
M('rear_delt','38,33 28,38 26,50 34,49 37,41')+
M('lats','38,49 44,51 43,90 30,92 31,62')+
M('mid_back','41,48 59,48 58,73 42,73',false)+
M('lower_back','42,75 58,75 57,105 43,105',false)+
M('triceps','26,53 33,52 32,76 25,74')+
M('forearms','25,78 32,77 31,102 24,100')+
M('glutes','33,119 49,119 49,151 32,151 31,132')+
M('hamstrings','32,153 49,153 48,197 31,194')+
M('calves','32,201 48,202 46,232 33,230')
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="375" viewBox="0 0 200 250">
<rect width="200" height="250" fill="#0d0d10"/>
<g transform="translate(0,0)">${front}</g>
<g transform="translate(100,0)">${back}</g>
</svg>`
await sharp(Buffer.from(svg)).png().toFile('preview_body.png')
console.log('done')
