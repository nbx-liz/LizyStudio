/**
 * Plotly wrapper that uses the minified dist to keep bundle small.
 */
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";

const Plot = createPlotlyComponent(Plotly);

export { Plot };
