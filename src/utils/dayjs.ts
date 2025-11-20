import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';

dayjs.extend(utc);
dayjs.extend(isSameOrBefore);

export default dayjs;
