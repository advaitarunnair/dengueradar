import datetime as dt

from common import date_to_epi_week, epi_week_start


def test_epi_week_roundtrip():
    for year in range(2012, 2027):
        for week in (1, 2, 26, 52):
            start = epi_week_start(year, week)
            assert start.weekday() == 6  # Sunday
            assert date_to_epi_week(start) == (year, week)
            assert date_to_epi_week(start + dt.timedelta(days=6)) == (year, week)


def test_known_epi_weeks():
    assert epi_week_start(2020, 1) == dt.date(2019, 12, 29)
    assert date_to_epi_week(dt.date(2020, 12, 31)) == (2020, 53)
