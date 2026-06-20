// Front + back anatomical body map, powered by react-body-highlighter.
// `data` is the library's exercise-data array (one entry per muscle, with a `frequency`
// that indexes into the amber `highlightedColors` gradient). Higher frequency = hotter.
import Model from 'react-body-highlighter'

const BODY_COLOR = '#34343b'
const AMBER_RAMP = ['#6e4d18', '#946523', '#bd8024', '#d89620', '#E8A020']

export default function BodySVG({ data = [] }) {
  return (
    <div className="body-svg-wrap">
      <div className="body-svg-half">
        <Model
          data={data}
          type="anterior"
          bodyColor={BODY_COLOR}
          highlightedColors={AMBER_RAMP}
          style={{ width: '100%' }}
          svgStyle={{ width: '100%', height: 'auto' }}
        />
        <div className="body-svg-label">Front</div>
      </div>
      <div className="body-svg-half">
        <Model
          data={data}
          type="posterior"
          bodyColor={BODY_COLOR}
          highlightedColors={AMBER_RAMP}
          style={{ width: '100%' }}
          svgStyle={{ width: '100%', height: 'auto' }}
        />
        <div className="body-svg-label">Back</div>
      </div>
    </div>
  )
}
