/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { of } from 'rxjs';

import { StatusPublicComponent } from './status-public.component';

describe('StatusPublicComponent', () => {
  let component: StatusPublicComponent;
  let statusPagePublicService: jasmine.SpyObj<any>;
  let titleService: jasmine.SpyObj<any>;
  let notifySvc: jasmine.SpyObj<any>;
  let i18nSvc: { fanyi: jasmine.Spy };

  beforeEach(() => {
    statusPagePublicService = jasmine.createSpyObj('StatusPagePublicService', ['getStatusPageOrg', 'getStatusPageComponents', 'getStatusPageIncidents']);
    titleService = jasmine.createSpyObj('TitleService', ['setTitle']);
    notifySvc = jasmine.createSpyObj('NzNotificationService', ['error']);
    i18nSvc = {
      fanyi: jasmine.createSpy('fanyi').and.callFake((key: string) => key)
    };

    statusPagePublicService.getStatusPageOrg.and.returnValue(of({ code: 0, data: { name: 'Test Org' } }));
    statusPagePublicService.getStatusPageComponents.and.returnValue(of({ code: 0, data: [] }));

    component = new StatusPublicComponent(notifySvc, titleService, statusPagePublicService, i18nSvc as any);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load default 30d range without query params', () => {
    component.loadStatusPageOrg();

    expect(statusPagePublicService.getStatusPageComponents).toHaveBeenCalledWith(undefined, undefined);
  });

  it('should reload component status with 24h params after range change', () => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-03-26T12:00:00Z'));

    component.onComponentRangeChange('24h');

    const endTime = new Date('2026-03-26T12:00:00Z').getTime();
    expect(statusPagePublicService.getStatusPageComponents).toHaveBeenCalledWith(endTime - 24 * 60 * 60 * 1000, endTime);

    jasmine.clock().uninstall();
  });
});
