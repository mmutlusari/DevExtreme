import BaseAppointmentsStrategy from './strategy.base';
import { extend } from '../../../../core/utils/extend';
import { isNumeric } from '../../../../core/utils/type';
import dateUtils from '../../../../core/utils/date';
import timeZoneUtils from '../../utils.timeZone';
import { ExpressionUtils } from '../../expressionUtils';
import { createAppointmentAdapter } from '../../appointmentAdapter';

const ALLDAY_APPOINTMENT_MIN_VERTICAL_OFFSET = 5;
const ALLDAY_APPOINTMENT_MAX_VERTICAL_OFFSET = 20;

const toMs = dateUtils.dateToMilliseconds;

class VerticalRenderingStrategy extends BaseAppointmentsStrategy {
    getDeltaTime(args, initialSize, appointment) {
        let deltaTime = 0;

        if(this.isAllDay(appointment)) {
            deltaTime = this._getDeltaWidth(args, initialSize) * toMs('day');
        } else {
            const deltaHeight = args.height - initialSize.height;
            deltaTime = toMs('minute') * Math.round(deltaHeight / this.cellHeight * this.instance.getAppointmentDurationInMinutes());
        }
        return deltaTime;
    }

    _correctCollectorCoordinatesInAdaptive(coordinates, isAllDay) {
        if(isAllDay) {
            super._correctCollectorCoordinatesInAdaptive(coordinates, isAllDay);
        } else if(this._getMaxAppointmentCountPerCellByType() === 0) {
            const cellHeight = this.cellHeight;
            const cellWidth = this.cellWidth;

            coordinates.top += (cellHeight - this.getDropDownButtonAdaptiveSize()) / 2;
            coordinates.left += (cellWidth - this.getDropDownButtonAdaptiveSize()) / 2;
        }
    }

    getAppointmentGeometry(coordinates) {
        let geometry = null;
        if(coordinates.allDay) {
            geometry = this._getAllDayAppointmentGeometry(coordinates);
        } else {
            geometry = this.isAdaptive && coordinates.isCompact ? this._getAdaptiveGeometry(coordinates) : this._getVerticalAppointmentGeometry(coordinates);
        }

        return super.getAppointmentGeometry(geometry);
    }

    _getAdaptiveGeometry(coordinates) {
        const config = this._calculateGeometryConfig(coordinates);
        return this._customizeCoordinates(coordinates, config.height, config.appointmentCountPerCell, config.offset);
    }

    _getItemPosition(appointment) {
        const adapter = createAppointmentAdapter(this.key, appointment);

        const allDay = this.isAllDay(appointment);
        const isRecurring = !!adapter.recurrenceRule;

        const appointmentStartDate = adapter.calculateStartDate('toGrid');
        const appointmentEndDate = adapter.calculateEndDate('toGrid');

        const isAppointmentTakesSeveralDays = !timeZoneUtils.isSameAppointmentDates(appointmentStartDate, appointmentEndDate);

        if(allDay) {
            return super._getItemPosition(appointment);
        }

        const settings = this.generateAppointmentSettings(appointment);
        let result = [];

        for(let j = 0; j < settings.length; j++) {
            const currentSetting = settings[j];
            const height = this.calculateAppointmentHeight(appointment, currentSetting);
            const width = this.calculateAppointmentWidth(appointment, currentSetting);

            let resultHeight = height;
            let appointmentReduced = null;
            let multiDaysAppointmentParts = [];
            const currentMaxAllowedPosition = currentSetting.vMax;

            if(this._isMultiViewAppointment(currentSetting, height) || (isAppointmentTakesSeveralDays && !isRecurring)) {
                const reduceHead = dateUtils.sameDate(appointmentStartDate, currentSetting.info.appointment.startDate) || isRecurring;

                if(reduceHead) {
                    resultHeight = this._reduceMultiDayAppointment(height, {
                        top: currentSetting.top,
                        bottom: currentMaxAllowedPosition
                    });

                    multiDaysAppointmentParts = this._getAppointmentParts({
                        sourceAppointmentHeight: height,
                        reducedHeight: resultHeight,
                        width
                    }, currentSetting);
                }

                const isMultiDay = this._isMultiDayAppointment(currentSetting, height);
                if(isMultiDay) {
                    appointmentReduced = reduceHead
                        ? 'head'
                        : 'tail';
                }
            }

            extend(currentSetting, {
                height: resultHeight,
                width: width,
                allDay: allDay,
                appointmentReduced: appointmentReduced
            });

            result = this._getAppointmentPartsPosition(multiDaysAppointmentParts, currentSetting, result);
        }

        return result;
    }

    _isMultiDayAppointment(position, height) {
        if(this.isVirtualScrolling) {
            const maxTop = this._getGroupHeight() - this._getGroupTopOffset(position);

            return height > maxTop;
        }

        return false;
    }

    _isMultiViewAppointment(position, height) {
        return height > (position.vMax - position.top);
    }

    _reduceMultiDayAppointment(sourceAppointmentHeight, bound) {
        sourceAppointmentHeight = bound.bottom - Math.floor(bound.top);

        return sourceAppointmentHeight;
    }

    _getGroupHeight() {
        const workspace = this.instance.getWorkSpace();

        return workspace.getCellHeight() * workspace._getRowCount();
    }

    _getGroupTopOffset(appointmentSettings) {
        const groupTop = Math.max(0, this.instance.fire('getGroupTop', appointmentSettings.groupIndex));
        const allDayPanelOffset = this.instance.fire('getOffsetByAllDayPanel', appointmentSettings.groupIndex);
        const appointmentGroupTopOffset = appointmentSettings.top - groupTop - allDayPanelOffset;

        return appointmentGroupTopOffset;
    }

    _getTailHeight(appointmentGeometry, appointmentSettings) {
        if(!this.isVirtualScrolling) {
            return appointmentGeometry.sourceAppointmentHeight - appointmentGeometry.reducedHeight;
        }

        const appointmentGroupTopOffset = this._getGroupTopOffset(appointmentSettings);
        const { sourceAppointmentHeight } = appointmentGeometry;

        const groupHeight = this._getGroupHeight();
        const tailHeight = appointmentGroupTopOffset + sourceAppointmentHeight - groupHeight;

        return tailHeight;
    }

    _getAppointmentParts(appointmentGeometry, appointmentSettings) {
        let tailHeight = this._getTailHeight(appointmentGeometry, appointmentSettings);
        const width = appointmentGeometry.width;
        const result = [];
        let currentPartTop = Math.max(0, this.instance.fire('getGroupTop', appointmentSettings.groupIndex));
        const cellsDiff = this.isGroupedByDate
            ? this.instance.fire('getGroupCount')
            : 1;
        const offset = this.cellWidth * cellsDiff;
        const left = appointmentSettings.left + offset;

        if(tailHeight > 0) {
            const minHeight = this.getAppointmentMinSize();

            if(tailHeight < minHeight) {
                tailHeight = minHeight;
            }

            currentPartTop += this.instance.fire('getOffsetByAllDayPanel', appointmentSettings.groupIndex);

            result.push(extend(true, {}, appointmentSettings, {
                top: currentPartTop,
                left: left,
                height: tailHeight,
                width: width,
                appointmentReduced: 'tail',
                rowIndex: 0,
                columnIndex: appointmentSettings.columnIndex + cellsDiff,
            }));
        }

        return result;
    }

    _getMinuteHeight() {
        return this.cellHeight / this.instance.getAppointmentDurationInMinutes();
    }

    _getCompactLeftCoordinate(itemLeft, index) {
        const cellBorderSize = 1;
        const cellWidth = this.cellWidth || this.getAppointmentMinSize();

        return itemLeft + (cellBorderSize + cellWidth) * index;
    }

    _getVerticalAppointmentGeometry(coordinates) {
        const config = this._calculateVerticalGeometryConfig(coordinates);

        return this._customizeVerticalCoordinates(coordinates, config.width, config.appointmentCountPerCell, config.offset);
    }

    _customizeVerticalCoordinates(coordinates, width, appointmentCountPerCell, topOffset, isAllDay) {
        const appointmentWidth = Math.max(width / appointmentCountPerCell, width / coordinates.count);
        const height = coordinates.height;
        const appointmentLeft = coordinates.left + (coordinates.index * appointmentWidth);
        const top = coordinates.top;

        if(coordinates.isCompact) {
            this._markAppointmentAsVirtual(coordinates, isAllDay);
        }

        return {
            height: height,
            width: appointmentWidth,
            top: top,
            left: appointmentLeft,
            empty: this._isAppointmentEmpty(height, width)
        };
    }

    _calculateVerticalGeometryConfig(coordinates) {
        const overlappingMode = this.maxAppointmentsPerCell;
        const offsets = this._getOffsets();
        const appointmentDefaultOffset = this._getAppointmentDefaultOffset();

        let appointmentCountPerCell = this._getAppointmentCount(overlappingMode, coordinates);
        let ratio = this._getDefaultRatio(coordinates, appointmentCountPerCell);
        let maxWidth = this._getMaxWidth();

        if(!appointmentCountPerCell) {
            appointmentCountPerCell = coordinates.count;
            ratio = (maxWidth - offsets.unlimited) / maxWidth;
        }

        let topOffset = (1 - ratio) * maxWidth;
        if(overlappingMode === 'auto' || isNumeric(overlappingMode)) {
            ratio = 1;
            maxWidth = maxWidth - appointmentDefaultOffset;
            topOffset = 0;
        }

        return {
            width: ratio * maxWidth,
            appointmentCountPerCell: appointmentCountPerCell,
            offset: topOffset
        };
    }

    _getMaxWidth() {
        return this.cellWidth || this.cellWidth;
    }

    isAllDay(appointmentData) {
        const allDay = ExpressionUtils.getField(this.key, 'allDay', appointmentData);

        if(allDay) {
            return true;
        }

        return this.instance.appointmentTakesAllDay(appointmentData);
    }

    _getAppointmentMaxWidth() {
        return this.cellWidth - this._getAppointmentDefaultOffset();
    }

    calculateAppointmentWidth(appointment, position) {
        if(!this.isAllDay(appointment)) {
            return 0;
        }

        const startDate = dateUtils.trimTime(position.info.appointment.startDate);
        const { normalizedEndDate } = position.info.appointment;

        const cellWidth = this.cellWidth || this.getAppointmentMinSize();
        const durationInHours = (normalizedEndDate.getTime() - startDate.getTime()) / toMs('hour');

        let width = Math.ceil(durationInHours / 24) * cellWidth;

        width = this.cropAppointmentWidth(width, cellWidth);
        return width;
    }

    calculateAppointmentHeight(appointment, position) {
        if(this.isAllDay(appointment)) {
            return 0;
        }

        const startDate = position.info.appointment.startDate;
        const { normalizedEndDate } = position.info.appointment;
        const allDay = ExpressionUtils.getField(this.key, 'allDay', appointment);
        const duration = this.getAppointmentDurationInMs(startDate, normalizedEndDate, allDay);
        const durationInMinutes = this._adjustDurationByDaylightDiff(duration, startDate, normalizedEndDate) / toMs('minute');

        const height = durationInMinutes * this._getMinuteHeight();

        return height;
    }

    getDirection() {
        return 'vertical';
    }

    _sortCondition(a, b) {
        const allDayCondition = a.allDay - b.allDay;
        const isAllDay = a.allDay && b.allDay;
        const condition = this.instance._groupOrientation === 'vertical' && isAllDay ? this._columnCondition(a, b) : this._rowCondition(a, b);
        return allDayCondition ? allDayCondition : condition;
    }

    hasAllDayAppointments() {
        return true;
    }

    _getAllDayAppointmentGeometry(coordinates) {
        const config = this._calculateGeometryConfig(coordinates);

        return this._customizeCoordinates(coordinates, config.height, config.appointmentCountPerCell, config.offset, true);
    }

    _calculateGeometryConfig(coordinates) {
        if(!this.instance._allowResizing() || !this.instance._allowAllDayResizing()) {
            coordinates.skipResizing = true;
        }

        const config = super._calculateGeometryConfig(coordinates);

        if(coordinates.count <= this._getDynamicAppointmentCountPerCell().allDay) {
            config.offset = 0;
        }

        return config;
    }

    _getAppointmentCount(overlappingMode, coordinates) {
        return overlappingMode !== 'auto' && (coordinates.count === 1 && !isNumeric(overlappingMode)) ? coordinates.count : this._getMaxAppointmentCountPerCellByType(coordinates.allDay);
    }

    _getDefaultRatio(coordinates, appointmentCountPerCell) {
        return coordinates.count > this.instance.option('_appointmentCountPerCell') ? 0.65 : 1;
    }

    _getOffsets() {
        return {
            unlimited: ALLDAY_APPOINTMENT_MIN_VERTICAL_OFFSET,
            auto: ALLDAY_APPOINTMENT_MAX_VERTICAL_OFFSET
        };
    }

    _getMaxHeight() {
        return this.allDayHeight || this.getAppointmentMinSize();
    }

    _needVerticalGroupBounds(allDay) {
        return !allDay;
    }

    _needHorizontalGroupBounds() {
        return false;
    }
}

export default VerticalRenderingStrategy;
