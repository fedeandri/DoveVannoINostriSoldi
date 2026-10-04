// Every converter that build-db.mjs runs, in order.
import * as medical from './medical.mjs';
import * as operators from './operators.mjs';

export const CONVERTERS = [medical, operators];
