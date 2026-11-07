import XCTest
final class RangeTests: XCTestCase {
 func testLongPressAtScrolledPositionThenDrag() throws {
  let app=XCUIApplication(bundleIdentifier:"com.chunguangwei.imagepilot.range166")
  continueAfterFailure=false
  app.launch()
  XCTAssertTrue(app.descendants(matching:.any).matching(identifier:"Jump").firstMatch.waitForExistence(timeout:30))
  app.descendants(matching:.any).matching(identifier:"Jump").firstMatch.tap()
  let offset=app.staticTexts["scroll-offset"]
  let scrolled=NSPredicate(format:"label == '800'")
  expectation(for:scrolled,evaluatedWith:offset)
  waitForExpectations(timeout:5)
  let first=app.buttons["photo-27"],last=app.buttons["photo-32"]
  XCTAssertTrue(first.exists);XCTAssertTrue(last.exists)
  first.press(forDuration:0.7)
  XCTAssertEqual(offset.label,"800","Long press must preserve native scroll offset")
  XCTAssertEqual(app.staticTexts["selection-count"].label,"1")
  // A second long press starts on a different, unselected photo.
  app.buttons["photo-28"].press(forDuration:0.7,thenDragTo:last)
  XCTAssertEqual(offset.label,"800")
  XCTAssertEqual(app.staticTexts["selection-count"].label,"6")
  XCTAssertEqual(app.staticTexts["refresh-count"].label,"0")
  let shot=XCTAttachment(screenshot:app.screenshot());shot.lifetime = .keepAlways;add(shot)
 }
 func testHoldingNearBottomExtendsSelectionAndStopsOnRelease() throws {
  continueAfterFailure=false
  let app=XCUIApplication(bundleIdentifier:"com.chunguangwei.imagepilot.range166")
  app.launch()
  let jump=app.descendants(matching:.any).matching(identifier:"Jump").firstMatch
  XCTAssertTrue(jump.waitForExistence(timeout:30));jump.tap()
  let offset=app.staticTexts["scroll-offset"]
  expectation(for:NSPredicate(format:"label == '800'"),evaluatedWith:offset)
  waitForExpectations(timeout:5)
  let start=app.buttons["photo-28"].coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.5))
  let edge=app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.97))
  start.press(forDuration:0.7,thenDragTo:edge,withVelocity:.slow,thenHoldForDuration:1.2)
  let endOffset=Int(offset.label) ?? 0
  XCTAssertGreaterThan(endOffset,900)
  XCTAssertGreaterThan(Int(app.staticTexts["selection-count"].label) ?? 0,6)
  XCTAssertEqual(app.staticTexts["refresh-count"].label,"0")
  // Normal swiping should resume after the finger is released.
  app.swipeDown()
  XCTAssertLessThan(Int(offset.label) ?? 0,endOffset)
 }

}
