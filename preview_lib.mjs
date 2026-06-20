import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ModelNS from 'react-body-highlighter'
import sharp from 'sharp'
const Model = ModelNS.default || ModelNS

const AMBER_RAMP = ['#6e4d18', '#946523', '#bd8024', '#d89620', '#E8A020']
const data = [
  { name: 'chest', muscles: ['chest'], frequency: 5 },
  { name: 'front-deltoids', muscles: ['front-deltoids'], frequency: 4 },
  { name: 'biceps', muscles: ['biceps'], frequency: 3 },
  { name: 'abs', muscles: ['abs'], frequency: 5 },
  { name: 'obliques', muscles: ['obliques'], frequency: 2 },
  { name: 'quadriceps', muscles: ['quadriceps'], frequency: 4 },
  { name: 'adductor', muscles: ['adductor'], frequency: 2 },
  { name: 'forearm', muscles: ['forearm'], frequency: 1 },
  { name: 'trapezius', muscles: ['trapezius'], frequency: 5 },
  { name: 'upper-back', muscles: ['upper-back'], frequency: 4 },
  { name: 'lower-back', muscles: ['lower-back'], frequency: 3 },
  { name: 'back-deltoids', muscles: ['back-deltoids'], frequency: 3 },
  { name: 'triceps', muscles: ['triceps'], frequency: 4 },
  { name: 'gluteal', muscles: ['gluteal'], frequency: 5 },
  { name: 'hamstring', muscles: ['hamstring'], frequency: 4 },
  { name: 'calves', muscles: ['calves'], frequency: 3 },
]
const opts = (type) => ({ data, type, bodyColor: '#34343b', highlightedColors: AMBER_RAMP })
let front = renderToStaticMarkup(React.createElement(Model, opts('anterior')))
let back  = renderToStaticMarkup(React.createElement(Model, opts('posterior')))
// strip wrapper div, keep svg
const svgOf = (html) => html.match(/<svg[\s\S]*<\/svg>/)[0].replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
front = svgOf(front); back = svgOf(back)
await sharp(Buffer.from(front)).resize(220).flatten({ background: '#0d0d10' }).png().toFile('preview_front.png')
await sharp(Buffer.from(back)).resize(220).flatten({ background: '#0d0d10' }).png().toFile('preview_back.png')
console.log('done')
